import { rrulestr } from 'rrule';
import { evaluateExpression, parseExpression } from './dsl.js';
import { createId, createItem } from './types.js';
import type {
  AutomationAction, AutomationLogEntry, AutomationRule, CustomValue, DomainEvent,
  UniversalItem, WorkspaceDocument,
} from './types.js';

export interface AutomationNotification { title: string; body: string; itemId?: string }
export interface AutomationRunResult {
  workspace: WorkspaceDocument;
  notifications: AutomationNotification[];
  processedEvents: number;
  actionsApplied: number;
}

const writableRoots = new Set(['title', 'bodyMarkdown', 'priority', 'contexts', 'tags', 'custom', 'schedule']);

function setPath(item: UniversalItem, path: string, value: CustomValue): void {
  const parts = path.split('.');
  if (!writableRoots.has(parts[0]!)) throw new Error(`Field is not writable by automation: ${path}`);
  let target: Record<string, unknown> = item as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    const current = target[part];
    if (!current || typeof current !== 'object' || Array.isArray(current)) target[part] = {};
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = value;
}

function logEntry(
  rule: AutomationRule,
  event: DomainEvent,
  outcome: AutomationLogEntry['outcome'],
  message: string | undefined,
  idempotencyKey: string,
  startedAt: string,
): AutomationLogEntry {
  return {
    id: createId(), ruleId: rule.id, ...(event.itemId ? { itemId: event.itemId } : {}),
    trigger: event.type, startedAt, finishedAt: new Date().toISOString(), outcome,
    ...(message ? { message } : {}), causationId: event.causationId, depth: event.depth, idempotencyKey,
  };
}

function applyAction(
  workspace: WorkspaceDocument,
  item: UniversalItem | undefined,
  action: AutomationAction,
  rule: AutomationRule,
  event: DomainEvent,
  notifications: AutomationNotification[],
): DomainEvent[] {
  const now = event.at;
  const emitted: DomainEvent[] = [];
  const requireItem = (): UniversalItem => {
    if (!item) throw new Error(`${action.type} requires an item`);
    return item;
  };
  switch (action.type) {
    case 'set_field': {
      const target = requireItem();
      const before = structuredClone(target);
      setPath(target, action.path, action.value);
      target.updatedAt = now; target.revision += 1;
      emitted.push({ id: createId(), type: 'item.updated', at: now, itemId: target.id, before, after: structuredClone(target), causationId: event.causationId, depth: event.depth + 1 });
      break;
    }
    case 'close': {
      const target = requireItem();
      const before = structuredClone(target);
      target.state = action.state;
      target.closure = { at: now, actor: 'automation', reason: action.state === 'auto_closed' ? 'auto_renew' : action.state === 'cancelled' ? 'cancelled' : 'rule', automationId: rule.id };
      target.updatedAt = now; target.revision += 1;
      emitted.push({ id: createId(), type: 'status.changed', at: now, itemId: target.id, before, after: structuredClone(target), causationId: event.causationId, depth: event.depth + 1 });
      break;
    }
    case 'archive': {
      const target = requireItem();
      const before = structuredClone(target);
      target.state = 'archived'; target.updatedAt = now; target.revision += 1;
      emitted.push({ id: createId(), type: 'status.changed', at: now, itemId: target.id, before, after: structuredClone(target), causationId: event.causationId, depth: event.depth + 1 });
      break;
    }
    case 'create_item': {
      const created = createItem(action.title, action.preset, new Date(now));
      workspace.items[created.id] = created;
      emitted.push({ id: createId(), type: 'item.created', at: now, itemId: created.id, after: structuredClone(created), causationId: event.causationId, depth: event.depth + 1 });
      break;
    }
    case 'add_relation': {
      const target = requireItem();
      if (!target.relations.some((relation) => relation.targetId === action.targetId && relation.type === action.relation)) {
        target.relations.push({ id: createId(), targetId: action.targetId, type: action.relation });
        target.updatedAt = now; target.revision += 1;
      }
      break;
    }
    case 'set_progress': {
      const target = requireItem();
      if (!target.progress) target.progress = { mode: 'counter', current: 0, target: 1 };
      target.progress.current = action.current; target.updatedAt = now; target.revision += 1;
      break;
    }
    case 'add_reminder': {
      const target = requireItem();
      if (!target.reminders.some((reminder) => reminder.id === action.reminder.id)) target.reminders.push(structuredClone(action.reminder));
      break;
    }
    case 'notify': notifications.push({ title: action.title, body: action.body, ...(item ? { itemId: item.id } : {}) }); break;
  }
  return emitted;
}

export function runAutomationEvents(
  workspace: WorkspaceDocument,
  initialEvents: DomainEvent[],
  options: { maxActions?: number; now?: Date } = {},
): AutomationRunResult {
  const notifications: AutomationNotification[] = [];
  const queue = [...initialEvents];
  const maxActions = options.maxActions ?? 100;
  const seen = new Set(workspace.automationLog.map((entry) => entry.idempotencyKey));
  let processedEvents = 0;
  let actionsApplied = 0;
  while (queue.length) {
    const event = queue.shift()!;
    processedEvents += 1;
    const rules = Object.values(workspace.automations).filter((rule) => rule.enabled && rule.trigger.type === event.type);
    for (const rule of rules) {
      const idempotencyKey = `${rule.id}:${event.id}`;
      if (seen.has(idempotencyKey)) continue;
      seen.add(idempotencyKey);
      const startedAt = (options.now ?? new Date()).toISOString();
      if (event.depth > rule.maxDepth || actionsApplied + rule.actions.length > maxActions) {
        rule.enabled = false;
        rule.disabledReason = 'Loop or action budget exceeded';
        workspace.automationLog.push(logEntry(rule, event, 'loop_blocked', rule.disabledReason, idempotencyKey, startedAt));
        continue;
      }
      const item = event.itemId ? workspace.items[event.itemId] : undefined;
      try {
        const ast = rule.condition.ast ?? parseExpression(rule.condition.source || 'true');
        const matches = item ? Boolean(evaluateExpression(ast, { item, now: new Date(event.at) })) : rule.condition.source.trim() === '' || rule.condition.source.trim() === 'true';
        if (!matches) {
          workspace.automationLog.push(logEntry(rule, event, 'skipped', 'Condition was false', idempotencyKey, startedAt));
          continue;
        }
        for (const action of rule.actions) {
          const emitted = applyAction(workspace, item, action, rule, event, notifications);
          queue.push(...emitted);
          actionsApplied += 1;
        }
        rule.lastRunAt = event.at;
        workspace.automationLog.push(logEntry(rule, event, 'success', undefined, idempotencyKey, startedAt));
      } catch (error) {
        workspace.automationLog.push(logEntry(rule, event, 'failed', error instanceof Error ? error.message : String(error), idempotencyKey, startedAt));
      }
    }
  }
  workspace.automationLog = workspace.automationLog.slice(-2_000);
  workspace.updatedAt = (options.now ?? new Date()).toISOString();
  return { workspace, notifications, processedEvents, actionsApplied };
}

export function collectScheduledEvents(workspace: WorkspaceDocument, now = new Date()): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const rule of Object.values(workspace.automations)) {
    if (!rule.enabled || rule.trigger.type !== 'time.schedule' || !rule.trigger.rrule) continue;
    const since = rule.lastRunAt ? new Date(rule.lastRunAt) : new Date(workspace.createdAt);
    const recurrence = rrulestr(rule.trigger.rrule, {
      dtstart: since,
      ...(rule.trigger.timezone ? { tzid: rule.trigger.timezone } : {}),
      compatible: true,
    });
    let dates = recurrence.between(since, now, false);
    if (rule.missedPolicy === 'skip') dates = [];
    if (rule.missedPolicy === 'run_once' && dates.length) dates = [dates.at(-1)!];
    for (const date of dates.slice(0, 1_000)) {
      events.push({ id: `${rule.id}:${date.toISOString()}`, type: 'time.schedule', at: date.toISOString(), causationId: createId(), depth: 0 });
    }
  }
  return events;
}
