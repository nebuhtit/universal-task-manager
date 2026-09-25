import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as Automerge from '@automerge/automerge';
import {
  backfillItemCreationVersions, collectScheduledEvents, consolidateHabitOccurrences, createId, effectiveWorkspaceNow,
  itemDeletionTime, migrateWorkspace, removeDuplicateReminders, removeDetachedCalendarTags, reminderTime, runAutomationEvents, validateWorkspace, SCHEMA_VERSION,
  type DomainEvent, type ReconcileResult, type WorkspaceDocument, type WorkspaceLanguage,
} from '@utm/core';
import {
  localWorkspaceMode, lock, passwordProtectionStatus, saveMigratedLocalWorkspace,
  unlockLocalWorkspaceWithoutPassword, unlockUnencryptedLocalWorkspace,
  type PasswordProtectionStatus, type UnlockedWorkspace,
} from '@utm/sdk';
import type { AppNotice } from '../components/layout/AppShell';
import { diagnosticFailureCode, googleCalendarFailureDetails, recordDiagnostic } from '../services/diagnostics';
import { beginStartup, failStartup, finishStartup, startupCheckpoint } from '../services/startupDiagnostics';
import { acquireWorkspaceWriter, releaseWorkspaceWriter, markPendingSave, clearPendingSave } from '../services/workspaceWriter';
import { clockService } from '../services/clockService';
import { getWorkspaceIndex } from '../services/workspaceIndex';
import { applyReconciliationResult, commitWorkspaceDocument, writableWorkspaceDocument } from '../services/workspaceLifecycle';
import { LatestPersistenceQueue, persistWorkspace, type PersistenceOperation } from '../services/workspacePersistence';
import { reconcileOffMainThread } from '../services/recurrenceWorker';
import { scheduleWorkspaceTime } from '../services/workspaceTimers';
import { nativeReminderSchedule, notificationItemMomentBody } from '../services/nativeReminders';
import { acknowledgeObsidianFlush, persistObsidianWorkspace, syncObsidianReminders } from '../services/obsidianBridge';

const ACTIVATION_PERSISTENCE_WAIT_MS = 5_000;

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Options = { onToast: (message: string) => void; setNotices: Dispatch<SetStateAction<AppNotice[]>> };

export function useWorkspaceController({ onToast, setNotices }: Options) {
  const [boot, setBoot] = useState<'checking' | 'empty' | 'locked' | 'ready'>('checking');
  const [passwordProtection, setPasswordProtection] = useState<PasswordProtectionStatus | 'checking'>('checking');
  const [session, setSession] = useState<UnlockedWorkspace | null>(null);
  const [saveStatus, setSaveStatus] = useState<'loaded' | 'saving' | 'saved' | 'error'>('loaded');
  const sessionRef = useRef<UnlockedWorkspace | null>(null);
  const persistenceQueue = useRef<LatestPersistenceQueue<PersistenceOperation> | null>(null);
  if (!persistenceQueue.current) {
    persistenceQueue.current = new LatestPersistenceQueue(
      async ({ session: target }) => persistWorkspace(target),
      ({ session: target, message, startedAt }) => {
        if (sessionRef.current?.document === target.document) { clearPendingSave(); setSaveStatus('saved'); }
        recordDiagnostic({ kind: 'result', message: 'Workspace operation persisted', operation: message, outcome: 'succeeded', durationMs: Math.round(performance.now() - startedAt) });
      },
      (reason, { message, startedAt }) => {
        setSaveStatus('error');
        recordDiagnostic({ kind: 'error', message: 'Workspace persistence is delayed and retained for retry', operation: message, outcome: 'failed', durationMs: Math.round(performance.now() - startedAt), details: reason instanceof Error ? reason.stack ?? reason.message : String(reason) });
        onToast(`Save is delayed; your latest change remains open and will retry: ${reason instanceof Error ? reason.message : String(reason)}`);
      },
    );
  }
  const deliveredReminderIds = useRef(new Set<string>());
  const recurrenceClock = useRef({ minute: Number.NaN, signature: '' });
  const workspace = session?.document as WorkspaceDocument | undefined;

  useEffect(() => {
    void localWorkspaceMode().then(async (mode) => {
      if (!mode) { setBoot('empty'); return; }
      // Pending markers survive force-close and are diagnostic, not proof of failure.
      // Try normal opening; the existing catch paths retain recovery on real errors.
      if (mode === 'plaintext') {
        beginStartup('automatic');
        setPasswordProtection('plaintext');
        try { await acquireWorkspaceWriter(); await activate(await unlockUnencryptedLocalWorkspace()); }
        catch (reason) {
          recordDiagnostic({ kind: 'error', message: 'Automatic test workspace entry failed', operation: 'Unlock unencrypted test workspace', outcome: 'failed', details: diagnosticFailureCode(reason) });
          setBoot('locked');
        }
        return;
      }
      const protection = await passwordProtectionStatus();
      setPasswordProtection(protection);
      if (protection === 'disabled') {
        beginStartup('automatic');
        try { await acquireWorkspaceWriter(); await activate(await unlockLocalWorkspaceWithoutPassword()); }
        catch (reason) {
          recordDiagnostic({ kind: 'error', message: 'Saved device unlock failed', operation: 'Unlock without password', outcome: 'failed', details: diagnosticFailureCode(reason) });
          setBoot('locked');
        }
      } else setBoot('locked');
    });
  }, []);

  const commit = (message: string, mutation: (draft: WorkspaceDocument) => void): boolean => {
    const currentSession = sessionRef.current;
    if (!currentSession) return false;
    const startedAt = performance.now();
    recordDiagnostic({ kind: 'action', message: 'Workspace operation started', operation: message, outcome: 'started' });
    let document: Automerge.Doc<WorkspaceDocument>;
    try { document = commitWorkspaceDocument(currentSession.document as Automerge.Doc<WorkspaceDocument>, message, mutation); }
    catch (reason) {
      const details = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
      recordDiagnostic({ kind: 'error', message: 'Workspace operation failed before persistence', operation: message, outcome: 'failed', durationMs: Math.round(performance.now() - startedAt), details: message === 'Sync Google Calendar' ? googleCalendarFailureDetails('save', reason) : details });
      onToast(`Save failed; nothing was changed: ${reason instanceof Error ? reason.message : String(reason)}`); return false;
    }
    const next = { ...currentSession, document }; sessionRef.current = next; setSession(next);
    markPendingSave(); setSaveStatus('saving');
    persistenceQueue.current?.enqueue({ session: next, message, startedAt });
    return true;
  };

  const activate = async (unlocked: UnlockedWorkspace, selectedLanguage?: WorkspaceLanguage) => {
    await acquireWorkspaceWriter();
    const activationStartedAt = performance.now();
    let activationCheckpointAt = activationStartedAt;
    const activationStages: Record<string, number> = {};
    let activationStage = 'prepare';
    const finishActivationStage = (stage: string) => {
      const now = performance.now();
      activationStages[stage] = Math.round(now - activationCheckpointAt);
      activationCheckpointAt = now;
    };
    try {
      startupCheckpoint('migration', 'started');
      deliveredReminderIds.current.clear();
    let notifications: Array<{ title: string; body: string; itemId?: string; reminderIds?: string[] }> = [];
    // Reuse a fresh storage document. A retry with an outdated head is forked
    // by writableWorkspaceDocument; persisted encrypted bytes stay untouched
    // until the normal verified persistence path succeeds.
    const sourceVersion = String(unlocked.document.schemaVersion ?? '1.0.0');
    activationStage = 'migration';
    // Current, valid documents need no whole-workspace structured clone for a
    // schema migration. That temporary copy can exhaust mobile Safari after a
    // large calendar import; keep the repair path for old or invalid data.
    const currentIntegrity = sourceVersion === SCHEMA_VERSION ? validateWorkspace(unlocked.document) : null;
    const activationDocument = writableWorkspaceDocument(unlocked.document as Automerge.Doc<WorkspaceDocument>);
    const now = effectiveWorkspaceNow(activationDocument as WorkspaceDocument);
    const migration = currentIntegrity?.valid
      ? { value: activationDocument as WorkspaceDocument, warnings: [] as string[] }
      : migrateWorkspace(activationDocument as WorkspaceDocument);
    const integrity = currentIntegrity?.valid ? currentIntegrity : validateWorkspace(migration.value);
    if (!integrity.valid) throw new Error(`Workspace integrity check failed (${integrity.errors.length} issues)`);
    const compactNormalizedDocument = sourceVersion === migration.value.schemaVersion && migration.warnings.length > 0;
    const migrationBase = compactNormalizedDocument
      ? Automerge.from(migration.value as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>
      : activationDocument;
    const migratedDocument = Automerge.change(migrationBase, 'Migrate workspace metadata and reminders', (draft) => {
      const targetWorkspace = draft as unknown as WorkspaceDocument;
      if (!compactNormalizedDocument && (targetWorkspace.schemaVersion !== migration.value.schemaVersion || migration.warnings.length > 0 || !targetWorkspace.calendarPreferences?.language || !Array.isArray(targetWorkspace.viewOrder))) { const target = targetWorkspace as unknown as Record<string, unknown>; Object.keys(target).forEach((key) => delete target[key]); Object.entries(migration.value as unknown as Record<string, unknown>).forEach(([key, value]) => { target[key] = clean(value); }); }
      if (selectedLanguage) targetWorkspace.calendarPreferences.language = selectedLanguage;
      removeDetachedCalendarTags(targetWorkspace);
      backfillItemCreationVersions(targetWorkspace); Object.values(targetWorkspace.items).forEach(removeDuplicateReminders); consolidateHabitOccurrences(targetWorkspace, now);
    });
    finishActivationStage('migration');
    startupCheckpoint('migration', 'completed', { items: Object.keys(migratedDocument.items).length });
    if (migration.warnings.length > 0) recordDiagnostic({ kind: 'result', message: 'Legacy workspace data normalized during entry', operation: 'Activate workspace', outcome: 'succeeded', details: JSON.stringify({ warningCount: migration.warnings.length, schemaVersion: migration.value.schemaVersion }) });
    let reconciliation: ReconcileResult; let warning = '';
    activationStage = 'recurrence';
    startupCheckpoint('recurrence', 'started');
    try { reconciliation = await reconcileOffMainThread(migratedDocument as WorkspaceDocument, now); }
    catch (reason) { reconciliation = { created: [], updated: [], autoClosed: [], removedIds: [], untouched: 0 }; warning = reason instanceof Error ? reason.message : String(reason); }
    if (reconciliation.errors?.length) warning = `${reconciliation.errors.length} incompatible recurring item${reconciliation.errors.length === 1 ? '' : 's'} skipped`;
    finishActivationStage('recurrence');
    startupCheckpoint('recurrence', 'completed');
    activationStage = 'apply-recurrence';
    startupCheckpoint('preparation', 'started');
    let updated = applyReconciliationResult(migratedDocument as Automerge.Doc<WorkspaceDocument>, reconciliation, now, 'Unlock reconciliation');
    if (reconciliation.errors?.length) updated = Automerge.change(updated, 'Quarantine incompatible recurrence', (draft) => {
      const targetWorkspace = draft as unknown as WorkspaceDocument;
      reconciliation.errors!.forEach(({ seriesId, message }) => {
        const item = targetWorkspace.items[seriesId];
        if (!item?.recurrence) return;
        const quarantine = item.extensions?.quarantine && typeof item.extensions.quarantine === 'object' && !Array.isArray(item.extensions.quarantine)
          ? item.extensions.quarantine as Record<string, unknown>
          : {};
        quarantine.recurrence = clean(item.recurrence);
        item.extensions = { ...item.extensions, quarantine };
        delete item.recurrence;
        if (item.role === 'series_template') item.role = 'standalone';
        item.updatedAt = now.toISOString(); item.revision += 1;
        const code = /no recurrence start or deadline/i.test(message) ? 'recurrence_missing_anchor' : 'invalid_recurrence';
        if (!targetWorkspace.migrationIssues.some((issue) => issue.entityId === seriesId && issue.code === code && issue.status !== 'resolved')) targetWorkspace.migrationIssues.push({ id: `activation:${seriesId}:${code}`, entityType: 'item', entityId: seriesId, sourceVersion, code, disabledCapability: 'recurrence', status: 'needs_repair', detectedAt: now.toISOString() });
      });
    });
    let disabledAutomations = 0;
    updated = Automerge.change(updated, 'Unlock scheduled events', (draft) => {
      const targetWorkspace = draft as unknown as WorkspaceDocument;
      const events: DomainEvent[] = reconciliation.created.map((item) => ({ id: createId(), type: 'occurrence.activated', at: now.toISOString(), itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }));
      const enabledBefore = Object.values(targetWorkspace.automations).filter((rule) => rule.enabled).length;
      events.push(...collectScheduledEvents(targetWorkspace, now));
      disabledAutomations = enabledBefore - Object.values(targetWorkspace.automations).filter((rule) => rule.enabled).length;
      notifications = runAutomationEvents(targetWorkspace, events, { now }).notifications;
    });
    finishActivationStage('scheduledEvents');
    for (const [stage, durationMs] of Object.entries(activationStages)) {
      recordDiagnostic({ kind: 'result', message: `Workspace entry stage: ${stage}`, operation: 'Activate workspace stage', outcome: 'succeeded', durationMs });
    }
    const groups = new Map<string, { count: number; urgency: 'normal' | 'urgent' | 'critical'; reminderIds: string[] }>(); const rank = { normal: 0, urgent: 1, critical: 2 } as const;
    for (const item of Object.values(updated.items)) { if (itemDeletionTime(updated, item) || item.state !== 'open' || item.role === 'series_template' || (item.schedule?.availableFrom && new Date(item.schedule.availableFrom) > now)) continue; for (const reminder of item.reminders) { const at = reminderTime(item, reminder); if (at && new Date(at) <= now) { const group = groups.get(item.id); if (!group) groups.set(item.id, { count: 1, urgency: reminder.urgency, reminderIds: [reminder.id] }); else { group.count += 1; group.reminderIds.push(reminder.id); if (rank[reminder.urgency] > rank[group.urgency]) group.urgency = reminder.urgency; } } } }
    groups.forEach((group, itemId) => { const item = updated.items[itemId]; if (item) { group.reminderIds.forEach((id) => deliveredReminderIds.current.add(id)); notifications.push({ title: item.title, body: notificationItemMomentBody(updated, item, now, `${group.count > 1 ? ` · ${group.count}` : ''}${group.urgency === 'normal' ? '' : ` · ${group.urgency}`}`), itemId, reminderIds: group.reminderIds }); } });
    activationStage = 'persistence';
    startupCheckpoint('preparation', 'completed');
    startupCheckpoint('persistence', 'started');
    const changedDuringActivation = compactNormalizedDocument || Automerge.getHeads(updated).join('|') !== Automerge.getHeads(activationDocument).join('|');
    if (changedDuringActivation) { markPendingSave(); setSaveStatus('saving'); }
    const activationPersistence = sourceVersion !== migration.value.schemaVersion || compactNormalizedDocument
      ? saveMigratedLocalWorkspace(updated, unlocked.dataKey, sourceVersion, `schema ${sourceVersion} to ${migration.value.schemaVersion}`)
      : changedDuringActivation
        ? persistWorkspace({ ...unlocked, document: updated })
        : unlocked.storageMode !== 'plaintext'
          ? persistObsidianWorkspace()
          : Promise.resolve();
    let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
    const persistenceOutcome = await Promise.race([
      activationPersistence.then(() => { startupCheckpoint('persistence', 'completed'); return 'saved' as const; }, (reason) => { startupCheckpoint('persistence', 'failed'); return { failed: reason } as const; }),
      new Promise<'pending'>((resolve) => { persistenceTimer = setTimeout(() => resolve('pending'), ACTIVATION_PERSISTENCE_WAIT_MS); }),
    ]);
    if (persistenceTimer) clearTimeout(persistenceTimer);
    if (persistenceOutcome === 'pending') {
      recordDiagnostic({ kind: 'result', message: 'Activation save continues in the background', operation: 'Activate workspace persistence', outcome: 'succeeded', details: JSON.stringify({ waitMs: ACTIVATION_PERSISTENCE_WAIT_MS }) });
      void activationPersistence.catch((reason) => recordDiagnostic({ kind: 'error', message: 'Background activation save failed', operation: 'Activate workspace persistence', outcome: 'failed', details: diagnosticFailureCode(reason) }));
    } else if (typeof persistenceOutcome === 'object') {
      setSaveStatus('error'); markPendingSave();
      warning = warning || 'Initial save failed and will retry after the next change';
      recordDiagnostic({ kind: 'error', message: 'Activation save failed without blocking entry', operation: 'Activate workspace persistence', outcome: 'failed', details: diagnosticFailureCode(persistenceOutcome.failed) });
    }
    finishActivationStage('persistence');
    activationStage = 'session';
    persistenceQueue.current?.clearPending();
    const activated = { ...unlocked, document: updated };
    if (typeof persistenceOutcome === 'object') {
      // Do not enter an editable session after a failed migration save: later
      // ordinary writes must not bypass its required rollback checkpoint.
      throw new Error('Initial workspace save failed. Original data is retained. Retry opening or use safe recovery mode.');
    } else if (persistenceOutcome === 'saved') { clearPendingSave(); setSaveStatus('loaded'); }
    else {
      // Wait before exposing an editable session: no ordinary write may race
      // the migration checkpoint or its original persistence operation.
      await activationPersistence;
      clearPendingSave(); setSaveStatus('loaded');
    }
    sessionRef.current = activated; setSession(activated);
    setPasswordProtection(unlocked.storageMode === 'plaintext' ? 'plaintext' : await passwordProtectionStatus());
    setBoot('ready');
    startupCheckpoint('render', 'started');
    if (unlocked.recoveredFromMirror) onToast('Opened a verified local recovery copy because the primary record could not be read. Check your latest changes and export a backup.');
    if (disabledAutomations) onToast(`Workspace opened. ${disabledAutomations} invalid automation schedules disabled; their settings are retained for repair.`);
    const activationDurationMs = Math.round(performance.now() - activationStartedAt);
    if (warning || activationDurationMs >= 1_500) recordDiagnostic({ kind: 'result', message: warning ? 'Workspace activation completed with a recurrence warning' : 'Workspace activation was slow', operation: 'Activate workspace', outcome: 'succeeded', durationMs: activationDurationMs, details: JSON.stringify({ stages: activationStages, recurrenceWarning: Boolean(warning), created: reconciliation.created.length, updated: reconciliation.updated.length, autoClosed: reconciliation.autoClosed.length, removed: reconciliation.removedIds.length, reminders: notifications.length }) });
    if (warning && !/timed out/i.test(warning)) onToast(reconciliation.errors?.length
      ? `Workspace opened. Recurrence disabled for ${reconciliation.errors.length} incompatible items; their data is retained. Review these items before re-enabling recurrence.`
      : `Workspace opened. Local saving continues safely in the background (${warning}).`);
    setNotices(notifications.map((notice) => ({ id: createId(), title: notice.title, body: notice.body, at: now.toISOString(), ...(notice.itemId ? { itemId: notice.itemId } : {}), ...(notice.reminderIds?.length ? { reminderIds: notice.reminderIds } : {}) })));
      if ('Notification' in window && Notification.permission === 'granted') notifications.forEach((notice) => new Notification(notice.title, { body: notice.body, ...(notice.itemId ? { tag: `reminder:${notice.itemId}` } : {}) }));
    } catch (reason) {
      failStartup();
      recordDiagnostic({ kind: 'error', message: `Workspace activation failed at ${activationStage}`, operation: 'Activate workspace', outcome: 'failed', durationMs: Math.round(performance.now() - activationStartedAt), details: diagnosticFailureCode(reason) });
      throw reason;
    }
  };

  useEffect(() => {
    if (boot !== 'ready') return;
    // Leave the attempt pending through first paint and immediate mount effects.
    const timer = window.setTimeout(finishStartup, 10_000);
    return () => window.clearTimeout(timer);
  }, [boot]);

  useEffect(() => {
    if (!workspace) return;
    syncObsidianReminders(nativeReminderSchedule(workspace, effectiveWorkspaceNow(workspace)));
    let cancelled = false;
    const workspaceIndex = getWorkspaceIndex(workspace);
    const recurrenceSignature = workspaceIndex.recurrence.seriesTemplates
      .filter((item) => item.recurrence)
      .map((item) => `${item.id}:${item.revision}`).sort().join('|');
    const reminderQueue = workspaceIndex.reminders.resolved.flatMap(({ itemId, reminder, resolvedAt }) => {
      const item = workspaceIndex.itemById.get(itemId);
      if (!item || item.state !== 'open' || item.role === 'series_template') return [];
      const availableAt = item.schedule?.availableFrom ? Date.parse(item.schedule.availableFrom) : Number.NEGATIVE_INFINITY;
      if (deliveredReminderIds.current.has(reminder.id)) return [];
      const reminderAt = Date.parse(resolvedAt);
      if (!Number.isFinite(reminderAt)) return [];
      return [{ itemId: item.id, reminderId: reminder.id, at: Math.max(reminderAt, Number.isFinite(availableAt) ? availableAt : Number.NEGATIVE_INFINITY) }];
    }).sort((left, right) => left.at - right.at);
    let reminderCursor = 0;
    let cancelReminderTimer: () => void = () => undefined;
    let cancelRecurrenceTimer: () => void = () => undefined;
    const deliverDueReminders = () => {
      if (cancelled) return;
      const now = effectiveWorkspaceNow(workspace, clockService.now());
      const dueByItem = new Map<string, string[]>();
      while (reminderCursor < reminderQueue.length && reminderQueue[reminderCursor]!.at <= now.getTime()) {
        const candidate = reminderQueue[reminderCursor++]!;
        if (deliveredReminderIds.current.has(candidate.reminderId)) continue;
        deliveredReminderIds.current.add(candidate.reminderId);
        dueByItem.set(candidate.itemId, [...(dueByItem.get(candidate.itemId) ?? []), candidate.reminderId]);
      }
      const due = [...dueByItem].flatMap(([itemId, reminderIds]) => {
        const item = workspace.items[itemId];
        return item ? [{ id: createId(), title: item.title, body: notificationItemMomentBody(workspace, item, now, reminderIds.length > 1 ? ` · ${reminderIds.length}` : ''), at: now.toISOString(), itemId, reminderIds } satisfies AppNotice] : [];
      });
      if (due.length) {
        setNotices((current) => [...current, ...due]);
        recordDiagnostic({ kind: 'result', message: 'Local reminders delivered', operation: 'Local reminder check', outcome: 'succeeded', details: JSON.stringify({ notices: due.length, reminders: due.reduce((total, notice) => total + (notice.reminderIds?.length ?? 0), 0), accelerated: Boolean(workspace.calendarPreferences.testClock?.enabled) }) });
        if ('Notification' in window && Notification.permission === 'granted') due.forEach((notice) => new Notification(notice.title, { body: notice.body, tag: `reminder:${notice.itemId}` }));
      }
      const next = reminderQueue[reminderCursor];
      if (next) cancelReminderTimer = scheduleWorkspaceTime(workspace, next.at - now.getTime(), deliverDueReminders);
    };
    const reconcileAtBoundary = async () => {
      if (cancelled || !recurrenceSignature) return;
      const now = effectiveWorkspaceNow(workspace, clockService.now());
      const minute = Math.floor(now.getTime() / 60_000);
      if (minute !== recurrenceClock.current.minute || recurrenceSignature !== recurrenceClock.current.signature) {
        recurrenceClock.current = { minute, signature: recurrenceSignature };
        try {
          const result = await reconcileOffMainThread(workspace, now);
          if (!cancelled && (result.created.length || result.updated.length || result.autoClosed.length || result.removedIds.length)) {
            commit('Clock recurrence reconciliation', (draft) => { result.created.forEach((item) => { if (!draft.items[item.id]) draft.items[item.id] = clean(item); }); [...result.updated, ...result.autoClosed].forEach((item) => { draft.items[item.id] = clean(item); }); result.removedIds.forEach((id) => { draft.tombstones[id] = now.toISOString(); delete draft.items[id]; }); });
            recordDiagnostic({ kind: 'result', message: 'Clock recurrence reconciliation changed items', operation: 'Clock recurrence reconciliation', outcome: 'succeeded', details: JSON.stringify({ created: result.created.length, updated: result.updated.length, autoClosed: result.autoClosed.length, removed: result.removedIds.length, accelerated: Boolean(workspace.calendarPreferences.testClock?.enabled) }) });
          }
        } catch (reason) {
          recordDiagnostic({ kind: 'error', message: 'Clock recurrence reconciliation failed', operation: 'Clock recurrence reconciliation', outcome: 'failed', details: reason instanceof Error ? reason.stack ?? reason.message : String(reason) });
        }
      }
      if (!cancelled) {
        const refreshedNow = effectiveWorkspaceNow(workspace, clockService.now());
        const untilNextMinute = 60_000 - (refreshedNow.getTime() % 60_000);
        cancelRecurrenceTimer = scheduleWorkspaceTime(workspace, untilNextMinute, () => { void reconcileAtBoundary(); });
      }
    };
    deliverDueReminders();
    void reconcileAtBoundary();
    return () => { cancelled = true; cancelReminderTimer(); cancelRecurrenceTimer(); };
  }, [workspace?.updatedAt, workspace?.calendarPreferences.testClock?.enabled]);

  const refreshPasswordProtection = async () => {
    const status = await passwordProtectionStatus();
    setPasswordProtection(status);
    return status;
  };
  const flushPersistence = async () => {
    await persistenceQueue.current?.flush();
  };

  useEffect(() => {
    const flushForHost = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail.id;
      void flushPersistence().then(() => acknowledgeObsidianFlush(id), (reason) => acknowledgeObsidianFlush(id, reason instanceof Error ? reason.message : String(reason)));
    };
    window.addEventListener('utm-obsidian-flush', flushForHost);
    return () => window.removeEventListener('utm-obsidian-flush', flushForHost);
  }, []);

  useEffect(() => {
    const flushBeforeBackground = () => {
      if (document.visibilityState === 'hidden') void flushPersistence().catch((reason) => {
        recordDiagnostic({ kind: 'error', message: 'Workspace flush on background failed', operation: 'Flush workspace before background', outcome: 'failed', details: diagnosticFailureCode(reason) });
      });
    };
    const flushBeforePageExit = () => {
      void flushPersistence().catch((reason) => {
        recordDiagnostic({ kind: 'error', message: 'Workspace flush on page exit failed', operation: 'Flush workspace before page exit', outcome: 'failed', details: diagnosticFailureCode(reason) });
      });
    };
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (saveStatus === 'saving' || saveStatus === 'error') { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warnUnsaved);
    document.addEventListener('visibilitychange', flushBeforeBackground);
    window.addEventListener('pagehide', flushBeforePageExit);
    window.addEventListener('beforeunload', flushBeforePageExit);
    return () => {
      document.removeEventListener('visibilitychange', flushBeforeBackground);
      window.removeEventListener('pagehide', flushBeforePageExit);
      window.removeEventListener('beforeunload', flushBeforePageExit);
      window.removeEventListener('beforeunload', warnUnsaved);
    };
  }, [saveStatus]);

  const lockWorkspace = async () => {
    if (session?.storageMode === 'plaintext') { onToast('An unencrypted test workspace cannot be locked. Create an encrypted workspace to use password lock.'); return; }
    if (passwordProtection === 'disabled') { onToast('Password protection is disabled on this device. Require the password in Settings before locking.'); return; }
    try { await flushPersistence(); }
    catch (reason) { onToast(`Cannot lock until the latest change is saved: ${reason instanceof Error ? reason.message : String(reason)}`); return; }
    if (session) lock(session); deliveredReminderIds.current.clear(); sessionRef.current = null; setSession(null); setBoot('locked');
    finishStartup();
    releaseWorkspaceWriter();
  };
  const adoptSession = async (next: UnlockedWorkspace, lockCurrent = false) => {
    await flushPersistence();
    if (lockCurrent && sessionRef.current) lock(sessionRef.current);
    persistenceQueue.current?.clearPending();
    deliveredReminderIds.current.clear(); sessionRef.current = next; setSession(next); setBoot('ready'); void refreshPasswordProtection();
  };
  const resetReminderDelivery = (ids: string[]) => ids.forEach((id) => deliveredReminderIds.current.delete(id));
  const getCurrentWorkspace = () => (sessionRef.current?.document as WorkspaceDocument | undefined) ?? null;
  const getCurrentSessionKey = () => sessionRef.current?.dataKey ?? null;
  return { boot, session, workspace, saveStatus, passwordProtection, refreshPasswordProtection, activate, commit, flushPersistence, lockWorkspace, adoptSession, resetReminderDelivery, getCurrentWorkspace, getCurrentSessionKey };
}
