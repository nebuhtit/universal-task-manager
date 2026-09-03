import {
  activeReminders,
  createOrganizationPriorityRanker,
  dueDateBuckets,
  evaluateFormulas,
  evaluateItemScripts,
  evaluateScriptsForItem,
  expressionDependsOnCurrentTime,
  listDefinitionFor,
  orderedOrganizationEntries,
  orderedTagEntries,
  reminderTime,
  type FormulaResult,
  type QueryRelationContext,
  type ItemScriptField,
  type ItemScriptResult,
  type ListDefinition,
  type Reminder,
  type UniversalItem,
  type WorkspaceDocument,
} from '@utm/core';

export type RelationIndexValue = {
  isSubtask: boolean;
  isParent: boolean;
  parentDepth: number;
  childDepth: number;
};

export type IndexedReminder = {
  reminder: Reminder;
  resolvedAt?: string;
};

type ComputedEntry<T> = { at?: number; value: T };

export interface WorkspaceIndex {
  readonly items: UniversalItem[];
  readonly visibleItems: UniversalItem[];
  readonly activeItems: UniversalItem[];
  readonly itemById: ReadonlyMap<string, UniversalItem>;
  readonly parentIdsByItemId: ReadonlyMap<string, readonly string[]>;
  readonly childIdsByItemId: ReadonlyMap<string, readonly string[]>;
  readonly recurrence: {
    readonly seriesTemplates: readonly UniversalItem[];
    readonly seriesById: ReadonlyMap<string, UniversalItem>;
    readonly occurrencesBySeriesId: ReadonlyMap<string, readonly UniversalItem[]>;
    readonly seriesIdByOccurrenceId: ReadonlyMap<string, string>;
  };
  readonly reminders: {
    readonly byItemId: ReadonlyMap<string, readonly IndexedReminder[]>;
    readonly resolved: readonly { itemId: string; reminder: Reminder; resolvedAt: string }[];
    readonly unresolved: readonly { itemId: string; reminder: Reminder }[];
  };
  readonly scripts: {
    readonly itemDefinitionsByItemId: ReadonlyMap<string, readonly ItemScriptField[]>;
    readonly viewDefinitionsByViewId: ReadonlyMap<string, readonly ItemScriptField[]>;
    readonly allItemDefinitions: readonly ItemScriptField[];
  };
  readonly areaOrder: readonly (string | null)[];
  readonly projectOrder: readonly (string | null)[];
  readonly tagOrder: readonly (string | null)[];
  readonly workspaceBoundaries: readonly number[];
  relationFor(item: UniversalItem): RelationIndexValue;
  queryItemFor(item: UniversalItem): UniversalItem;
  queryContextFor(item: UniversalItem, now?: Date): QueryRelationContext;
  parentFor(item: UniversalItem): UniversalItem | undefined;
  rankFor(kind: 'area' | 'project' | 'tag', name: string | null): number;
  organizationRankFor(item: UniversalItem): number;
  listDefinitionFor(name: string | undefined, now?: Date): ListDefinition | undefined;
  remindersFor(item: UniversalItem): readonly IndexedReminder[];
  formulasFor(item: UniversalItem, now?: Date): FormulaResult;
  itemScriptsFor(item: UniversalItem, now?: Date): ItemScriptResult;
  viewScriptsFor(item: UniversalItem, definitions: readonly ItemScriptField[], now?: Date): ItemScriptResult;
}

const workspaceIndexes = new WeakMap<WorkspaceDocument, { index: WorkspaceIndex; itemCount: number; updatedAt: string }>();

function safelyDependsOnTime(sources: readonly (string | undefined)[]): boolean {
  return sources.some((source) => {
    if (!source) return false;
    try { return expressionDependsOnCurrentTime(source); }
    catch { return false; }
  });
}

function cachedComputed<T>(
  cache: WeakMap<UniversalItem, ComputedEntry<T>>,
  item: UniversalItem,
  now: Date,
  dependsOnTime: boolean,
  calculate: () => T,
): T {
  const at = dependsOnTime ? now.getTime() : undefined;
  const cached = cache.get(item);
  if (cached && cached.at === at) return cached.value;
  const value = calculate();
  cache.set(item, { ...(at === undefined ? {} : { at }), value });
  return value;
}

function buildWorkspaceIndex(workspace: WorkspaceDocument): WorkspaceIndex {
  const items = Object.values(workspace.items);
  const visibleItems = items.filter((item) => !item.deletedAt);
  const activeItems = visibleItems.filter((item) => item.state === 'open');
  const itemById = new Map(items.map((item) => [item.id, item]));
  const parentIdsByItemId = new Map<string, string[]>();
  const childIdsByItemId = new Map<string, string[]>();

  for (const item of items) {
    const children = item.relations
      .filter((relation) => relation.type === 'parent' && itemById.has(relation.targetId))
      .map((relation) => relation.targetId);
    if (children.length) childIdsByItemId.set(item.id, children);
    for (const childId of children) parentIdsByItemId.set(childId, [...(parentIdsByItemId.get(childId) ?? []), item.id]);
  }

  const seriesTemplates = visibleItems.filter((item) => item.role === 'series_template');
  const seriesById = new Map(seriesTemplates.map((item) => [item.id, item]));
  const occurrencesBySeriesId = new Map<string, UniversalItem[]>();
  const seriesIdByOccurrenceId = new Map<string, string>();
  for (const item of visibleItems) {
    const seriesId = item.role === 'occurrence' ? item.occurrence?.seriesId : undefined;
    if (!seriesId) continue;
    seriesIdByOccurrenceId.set(item.id, seriesId);
    occurrencesBySeriesId.set(seriesId, [...(occurrencesBySeriesId.get(seriesId) ?? []), item]);
  }

  const remindersByItemId = new Map<string, IndexedReminder[]>();
  const resolvedReminders: Array<{ itemId: string; reminder: Reminder; resolvedAt: string }> = [];
  const unresolvedReminders: Array<{ itemId: string; reminder: Reminder }> = [];
  for (const item of visibleItems) {
    const indexed = activeReminders(item).map((reminder) => {
      const resolvedAt = reminderTime(item, reminder);
      if (resolvedAt) resolvedReminders.push({ itemId: item.id, reminder, resolvedAt });
      else unresolvedReminders.push({ itemId: item.id, reminder });
      return { reminder, ...(resolvedAt ? { resolvedAt } : {}) };
    }).sort((left, right) => left.resolvedAt && right.resolvedAt
      ? Date.parse(left.resolvedAt) - Date.parse(right.resolvedAt)
      : left.resolvedAt ? -1 : right.resolvedAt ? 1 : 0);
    remindersByItemId.set(item.id, indexed);
  }
  resolvedReminders.sort((left, right) => Date.parse(left.resolvedAt) - Date.parse(right.resolvedAt));

  const itemDefinitionsByItemId = new Map(items.map((item) => [item.id, item.scripts ?? []]));
  const viewDefinitionsByViewId = new Map(Object.values(workspace.views).map((view) => [view.id, view.scripts ?? []]));
  const allItemDefinitions = items.flatMap((item) => item.scripts ?? []);
  const areaOrder = orderedOrganizationEntries(workspace, 'area');
  const projectOrder = orderedOrganizationEntries(workspace, 'project');
  const tagOrder = orderedTagEntries(workspace);
  const ranks = new Map<string, number>();
  const addRanks = (kind: 'area' | 'project' | 'tag', order: readonly (string | null)[]) => order.forEach((name, index) => {
    ranks.set(`${kind}:${name ?? '\u0000'}`, order.length - index);
  });
  addRanks('area', areaOrder); addRanks('project', projectOrder); addRanks('tag', tagOrder);
  const organizationRank = createOrganizationPriorityRanker(workspace);
  const organizationRanksByItem = new Map(items.map((item) => [item, organizationRank(item)]));

  const listDefinitions = new Map<string, ListDefinition>();
  const listNames = new Set(items.map((item) => item.list?.trim()).filter((name): name is string => Boolean(name)));
  for (const name of listNames) {
    const definition = listDefinitionFor(workspace, name);
    if (definition) listDefinitions.set(name, definition);
  }

  const scheduleBoundaries = items.flatMap((item) => [item.schedule?.availableFrom, item.schedule?.startAt, item.schedule?.endAt, item.schedule?.dueAt]);
  const workspaceBoundaries = [...scheduleBoundaries, ...resolvedReminders.map((entry) => entry.resolvedAt)]
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  const formulaDefinitions = Object.values(workspace.customFields);
  const formulasDependOnTime = safelyDependsOnTime(formulaDefinitions.map((definition) => definition.formula));
  const formulaCache = new WeakMap<UniversalItem, ComputedEntry<FormulaResult>>();
  const itemScriptCache = new WeakMap<UniversalItem, ComputedEntry<ItemScriptResult>>();
  const dueBucketCache = new WeakMap<UniversalItem, ComputedEntry<ReturnType<typeof dueDateBuckets>>>();
  const queryItemCache = new WeakMap<UniversalItem, UniversalItem>();
  const viewScriptCaches = new Map<string, WeakMap<UniversalItem, ComputedEntry<ItemScriptResult>>>();
  const resolveItem = (id: string) => workspace.items[id];

  const relationFor = (item: UniversalItem): RelationIndexValue => {
    const parentDepth = parentIdsByItemId.has(item.id) ? 1 : 0;
    const childDepth = childIdsByItemId.has(item.id) ? 1 : 0;
    return { isSubtask: parentDepth > 0, isParent: childDepth > 0, parentDepth, childDepth };
  };

  return {
    items,
    visibleItems,
    activeItems,
    itemById,
    parentIdsByItemId,
    childIdsByItemId,
    recurrence: { seriesTemplates, seriesById, occurrencesBySeriesId, seriesIdByOccurrenceId },
    reminders: { byItemId: remindersByItemId, resolved: resolvedReminders, unresolved: unresolvedReminders },
    scripts: { itemDefinitionsByItemId, viewDefinitionsByViewId, allItemDefinitions },
    areaOrder,
    projectOrder,
    tagOrder,
    workspaceBoundaries,
    relationFor,
    queryItemFor: (item) => {
      const cached = queryItemCache.get(item);
      if (cached) return cached;
      const areas = [...new Set([...(item.areas ?? []), ...(item.area ? [item.area] : [])])];
      const projects = [...new Set([...(item.projects ?? []), ...(item.project ? [item.project] : [])])];
      const queryItem = { ...item, area: areas.length ? areas : undefined, project: projects.length ? projects : undefined } as unknown as UniversalItem;
      queryItemCache.set(item, queryItem);
      return queryItem;
    },
    queryContextFor: (item, now = new Date()) => {
      const indexedItem = itemById.get(item.id);
      const matchesIndexedItem = Boolean(indexedItem && indexedItem.revision === item.revision && indexedItem.schedule === item.schedule && indexedItem.reminders === item.reminders);
      const reminderEntries = matchesIndexedItem ? remindersByItemId.get(item.id) ?? [] : activeReminders(item).map((reminder) => {
        const resolvedAt = reminderTime(item, reminder);
        return { reminder, ...(resolvedAt ? { resolvedAt } : {}) };
      });
      const buckets = cachedComputed(dueBucketCache, item, now, true, () => dueDateBuckets(item, now, {
        timeZone: workspace.calendarPreferences.timezone,
        weekStartsOn: workspace.calendarPreferences.weekStartsOn,
      }));
      const nextReminderAt = reminderEntries.find((entry) => entry.resolvedAt)?.resolvedAt;
      return { ...relationFor(item), hasActiveReminders: reminderEntries.length > 0, ...(nextReminderAt ? { nextReminderAt } : {}), remindersIndexed: true, dueDateBuckets: buckets };
    },
    parentFor: (item) => itemById.get(parentIdsByItemId.get(item.id)?.[0] ?? ''),
    rankFor: (kind, name) => ranks.get(`${kind}:${name ?? '\u0000'}`) ?? 0,
    organizationRankFor: (item) => organizationRanksByItem.get(item) ?? organizationRank(item),
    listDefinitionFor: (name, now = new Date()) => name?.trim() ? listDefinitions.get(name.trim()) ?? listDefinitionFor(workspace, name, now) : undefined,
    remindersFor: (item) => (itemById.get(item.id) === item ? remindersByItemId.get(item.id) : undefined) ?? activeReminders(item).map((reminder) => {
      const resolvedAt = reminderTime(item, reminder);
      return { reminder, ...(resolvedAt ? { resolvedAt } : {}) };
    }).sort((left, right) => left.resolvedAt && right.resolvedAt
      ? Date.parse(left.resolvedAt) - Date.parse(right.resolvedAt)
      : left.resolvedAt ? -1 : right.resolvedAt ? 1 : 0),
    formulasFor: (item, now = new Date()) => cachedComputed(formulaCache, item, now, formulasDependOnTime, () => evaluateFormulas(item, formulaDefinitions, now)),
    itemScriptsFor: (item, now = new Date()) => cachedComputed(itemScriptCache, item, now, safelyDependsOnTime((item.scripts ?? []).map((script) => script.source)), () => evaluateItemScripts(item, resolveItem, now)),
    viewScriptsFor: (item, definitions, now = new Date()) => {
      const signature = definitions.map((script) => `${script.id}\u0000${script.key}\u0000${script.source}\u0000${script.resultKind}`).join('\u0001');
      let cache = viewScriptCaches.get(signature);
      if (!cache) { cache = new WeakMap(); viewScriptCaches.set(signature, cache); }
      return cachedComputed(cache, item, now, safelyDependsOnTime(definitions.map((script) => script.source)), () => evaluateScriptsForItem(item, definitions, resolveItem, now));
    },
  };
}

/**
 * Returns the immutable derived index shared by every consumer of one workspace
 * revision. View entry points may validate the item count for legacy callers
 * that still mutate a workspace object in place.
 */
export function getWorkspaceIndex(workspace: WorkspaceDocument, validateShape = false): WorkspaceIndex {
  const cached = workspaceIndexes.get(workspace);
  if (cached && cached.updatedAt === workspace.updatedAt && (!validateShape || cached.itemCount === Object.keys(workspace.items).length)) return cached.index;
  const index = buildWorkspaceIndex(workspace);
  workspaceIndexes.set(workspace, { index, itemCount: index.items.length, updatedAt: workspace.updatedAt });
  return index;
}
