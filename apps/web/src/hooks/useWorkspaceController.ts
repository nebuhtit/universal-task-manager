import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as Automerge from '@automerge/automerge';
import {
  backfillItemCreationVersions, collectScheduledEvents, consolidateHabitOccurrences, createId, effectiveWorkspaceNow,
  migrateWorkspace, removeDuplicateReminders, runAutomationEvents, validateWorkspace,
  type DomainEvent, type ReconcileResult, type WorkspaceDocument, type WorkspaceLanguage,
} from '@utm/core';
import {
  localWorkspaceMode, lock, passwordProtectionStatus, saveLocalWorkspace, saveMigratedLocalWorkspace,
  unlockLocalWorkspaceWithoutPassword, unlockUnencryptedLocalWorkspace,
  type PasswordProtectionStatus, type UnlockedWorkspace,
} from '@utm/sdk';
import type { AppNotice } from '../components/layout/AppShell';
import { diagnosticFailureCode, recordDiagnostic } from '../services/diagnostics';
import { clockService } from '../services/clockService';
import { getWorkspaceIndex } from '../services/workspaceIndex';
import { applyReconciliationResult, commitWorkspaceDocument } from '../services/workspaceLifecycle';
import { LatestPersistenceQueue, persistWorkspace, type PersistenceOperation } from '../services/workspacePersistence';
import { reconcileOffMainThread } from '../services/recurrenceWorker';
import { scheduleWorkspaceTime } from '../services/workspaceTimers';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Options = { onToast: (message: string) => void; setNotices: Dispatch<SetStateAction<AppNotice[]>> };

export function useWorkspaceController({ onToast, setNotices }: Options) {
  const [boot, setBoot] = useState<'checking' | 'empty' | 'locked' | 'ready'>('checking');
  const [passwordProtection, setPasswordProtection] = useState<PasswordProtectionStatus | 'checking'>('checking');
  const [session, setSession] = useState<UnlockedWorkspace | null>(null);
  const sessionRef = useRef<UnlockedWorkspace | null>(null);
  const persistenceQueue = useRef<LatestPersistenceQueue<PersistenceOperation> | null>(null);
  if (!persistenceQueue.current) {
    persistenceQueue.current = new LatestPersistenceQueue(
      async ({ session: target }) => persistWorkspace(target),
      ({ message, startedAt }) => recordDiagnostic({ kind: 'result', message: 'Workspace operation persisted', operation: message, outcome: 'succeeded', durationMs: Math.round(performance.now() - startedAt) }),
      (reason, { message, startedAt }) => {
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
      if (mode === 'plaintext') {
        setPasswordProtection('plaintext');
        try { await activate(await unlockUnencryptedLocalWorkspace()); }
        catch (reason) {
          recordDiagnostic({ kind: 'error', message: 'Automatic test workspace entry failed', operation: 'Unlock unencrypted test workspace', outcome: 'failed', details: diagnosticFailureCode(reason) });
          setBoot('locked');
        }
        return;
      }
      const protection = await passwordProtectionStatus();
      setPasswordProtection(protection);
      if (protection === 'disabled') {
        try { await activate(await unlockLocalWorkspaceWithoutPassword()); }
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
      recordDiagnostic({ kind: 'error', message: 'Workspace operation failed before persistence', operation: message, outcome: 'failed', durationMs: Math.round(performance.now() - startedAt), details });
      onToast(`Save failed; nothing was changed: ${reason instanceof Error ? reason.message : String(reason)}`); return false;
    }
    const next = { ...currentSession, document }; sessionRef.current = next; setSession(next);
    persistenceQueue.current?.enqueue({ session: next, message, startedAt });
    return true;
  };

  const activate = async (unlocked: UnlockedWorkspace, selectedLanguage?: WorkspaceLanguage) => {
    const activationStartedAt = performance.now();
    let activationCheckpointAt = activationStartedAt;
    const activationStages: Record<string, number> = {};
    const finishActivationStage = (stage: string) => {
      const now = performance.now();
      activationStages[stage] = Math.round(now - activationCheckpointAt);
      activationCheckpointAt = now;
    };
    try {
      deliveredReminderIds.current.clear();
    let notifications: Array<{ title: string; body: string; itemId?: string; reminderIds?: string[] }> = [];
    const sourceVersion = String((unlocked.document as WorkspaceDocument).schemaVersion ?? '1.0.0');
    const now = effectiveWorkspaceNow(unlocked.document as WorkspaceDocument); const migration = migrateWorkspace(clean(unlocked.document as WorkspaceDocument));
    const integrity = validateWorkspace(migration.value);
    if (!integrity.valid) throw new Error(`Workspace integrity check failed (${integrity.errors.length} issues)`);
    const migratedDocument = Automerge.change(unlocked.document, 'Migrate workspace metadata and reminders', (draft) => {
      const targetWorkspace = draft as unknown as WorkspaceDocument;
      if (targetWorkspace.schemaVersion !== migration.value.schemaVersion || migration.warnings.length > 0 || !targetWorkspace.calendarPreferences?.language || !Array.isArray(targetWorkspace.viewOrder)) { const target = targetWorkspace as unknown as Record<string, unknown>; Object.keys(target).forEach((key) => delete target[key]); Object.entries(migration.value as unknown as Record<string, unknown>).forEach(([key, value]) => { target[key] = clean(value); }); }
      if (selectedLanguage) targetWorkspace.calendarPreferences.language = selectedLanguage;
      backfillItemCreationVersions(targetWorkspace); Object.values(targetWorkspace.items).forEach(removeDuplicateReminders); consolidateHabitOccurrences(targetWorkspace, now);
    });
    finishActivationStage('migration');
    if (migration.warnings.length > 0) recordDiagnostic({ kind: 'result', message: 'Legacy workspace data normalized during entry', operation: 'Activate workspace', outcome: 'succeeded', details: JSON.stringify({ warningCount: migration.warnings.length, schemaVersion: migration.value.schemaVersion }) });
    let reconciliation: ReconcileResult; let warning = '';
    try { reconciliation = await reconcileOffMainThread(migratedDocument as WorkspaceDocument, now); }
    catch (reason) { reconciliation = { created: [], updated: [], autoClosed: [], removedIds: [], untouched: 0 }; warning = reason instanceof Error ? reason.message : String(reason); }
    finishActivationStage('recurrence');
    let updated = applyReconciliationResult(migratedDocument as Automerge.Doc<WorkspaceDocument>, reconciliation, now, 'Unlock reconciliation');
    updated = Automerge.change(updated, 'Unlock scheduled events', (draft) => {
      const targetWorkspace = draft as unknown as WorkspaceDocument;
      const events: DomainEvent[] = reconciliation.created.map((item) => ({ id: createId(), type: 'occurrence.activated', at: now.toISOString(), itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }));
      events.push(...collectScheduledEvents(targetWorkspace, now)); notifications = runAutomationEvents(targetWorkspace, events, { now }).notifications;
    });
    finishActivationStage('scheduledEvents');
    const groups = new Map<string, { count: number; urgency: 'normal' | 'urgent' | 'critical'; reminderIds: string[] }>(); const rank = { normal: 0, urgent: 1, critical: 2 } as const;
    for (const item of Object.values(updated.items)) { if (item.state !== 'open' || item.role === 'series_template' || (item.schedule?.availableFrom && new Date(item.schedule.availableFrom) > now)) continue; for (const reminder of item.reminders) if (!reminder.acknowledgedAt && reminder.at && new Date(reminder.at) <= now) { const group = groups.get(item.id); if (!group) groups.set(item.id, { count: 1, urgency: reminder.urgency, reminderIds: [reminder.id] }); else { group.count += 1; group.reminderIds.push(reminder.id); if (rank[reminder.urgency] > rank[group.urgency]) group.urgency = reminder.urgency; } } }
    groups.forEach((group, itemId) => { const item = updated.items[itemId]; if (item) { group.reminderIds.forEach((id) => deliveredReminderIds.current.add(id)); notifications.push({ title: item.title, body: `Reminder${group.count > 1 ? `s · ${group.count}` : ''} · ${group.urgency}`, itemId, reminderIds: group.reminderIds }); } });
    if (sourceVersion !== migration.value.schemaVersion) await saveMigratedLocalWorkspace(updated, unlocked.dataKey, sourceVersion, `schema ${sourceVersion} to ${migration.value.schemaVersion}`);
    else await saveLocalWorkspace(updated, unlocked.dataKey, unlocked.storageMode);
    finishActivationStage('persistence');
    persistenceQueue.current?.clearPending();
    const activated = { ...unlocked, document: updated }; sessionRef.current = activated; setSession(activated);
    setPasswordProtection(unlocked.storageMode === 'plaintext' ? 'plaintext' : await passwordProtectionStatus());
    setBoot('ready');
    const activationDurationMs = Math.round(performance.now() - activationStartedAt);
    if (warning || activationDurationMs >= 1_500) recordDiagnostic({ kind: 'result', message: warning ? 'Workspace activation completed with a recurrence warning' : 'Workspace activation was slow', operation: 'Activate workspace', outcome: 'succeeded', durationMs: activationDurationMs, details: JSON.stringify({ stages: activationStages, recurrenceWarning: Boolean(warning), created: reconciliation.created.length, updated: reconciliation.updated.length, autoClosed: reconciliation.autoClosed.length, removed: reconciliation.removedIds.length, reminders: notifications.length }) });
    if (warning && !/timed out/i.test(warning)) onToast(`Workspace opened. Recurrence sync will retry in the background (${warning}).`);
    setNotices(notifications.map((notice) => ({ id: createId(), title: notice.title, body: notice.body, at: now.toISOString(), ...(notice.itemId ? { itemId: notice.itemId } : {}), ...(notice.reminderIds?.length ? { reminderIds: notice.reminderIds } : {}) })));
      if ('Notification' in window && Notification.permission === 'granted') notifications.forEach((notice) => new Notification(notice.title, { body: notice.body, ...(notice.itemId ? { tag: `reminder:${notice.itemId}` } : {}) }));
    } catch (reason) {
      recordDiagnostic({ kind: 'error', message: 'Workspace activation failed', operation: 'Activate workspace', outcome: 'failed', durationMs: Math.round(performance.now() - activationStartedAt), details: diagnosticFailureCode(reason) });
      throw reason;
    }
  };

  useEffect(() => {
    if (!workspace) return;
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
        return item ? [{ id: createId(), title: item.title, body: `Reminder${reminderIds.length > 1 ? `s · ${reminderIds.length}` : ''}`, at: now.toISOString(), itemId, reminderIds } satisfies AppNotice] : [];
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
    document.addEventListener('visibilitychange', flushBeforeBackground);
    window.addEventListener('pagehide', flushBeforePageExit);
    window.addEventListener('beforeunload', flushBeforePageExit);
    return () => {
      document.removeEventListener('visibilitychange', flushBeforeBackground);
      window.removeEventListener('pagehide', flushBeforePageExit);
      window.removeEventListener('beforeunload', flushBeforePageExit);
    };
  }, []);

  const lockWorkspace = async () => {
    if (session?.storageMode === 'plaintext') { onToast('An unencrypted test workspace cannot be locked. Create an encrypted workspace to use password lock.'); return; }
    if (passwordProtection === 'disabled') { onToast('Password protection is disabled on this device. Require the password in Settings before locking.'); return; }
    try { await flushPersistence(); }
    catch (reason) { onToast(`Cannot lock until the latest change is saved: ${reason instanceof Error ? reason.message : String(reason)}`); return; }
    if (session) lock(session); deliveredReminderIds.current.clear(); sessionRef.current = null; setSession(null); setBoot('locked');
  };
  const adoptSession = async (next: UnlockedWorkspace, lockCurrent = false) => {
    await flushPersistence();
    if (lockCurrent && sessionRef.current) lock(sessionRef.current);
    persistenceQueue.current?.clearPending();
    deliveredReminderIds.current.clear(); sessionRef.current = next; setSession(next); setBoot('ready'); void refreshPasswordProtection();
  };
  return { boot, session, workspace, passwordProtection, refreshPasswordProtection, activate, commit, flushPersistence, lockWorkspace, adoptSession };
}
