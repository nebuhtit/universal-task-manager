import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import * as Automerge from '@automerge/automerge';
import {
  backfillItemCreationVersions, collectScheduledEvents, consolidateHabitOccurrences, createId,
  migrateWorkspace, reconcileRecurrences, removeDuplicateReminders, runAutomationEvents,
  type DomainEvent, type ReconcileResult, type WorkspaceDocument, type WorkspaceLanguage,
} from '@utm/core';
import { hasLocalWorkspace, lock, saveLocalWorkspace, type UnlockedWorkspace } from '@utm/sdk';
import { effectiveWorkspaceNow } from '../features/views';
import type { AppNotice } from '../components/layout/AppShell';
import { applyReconciliationResult, commitWorkspaceDocument } from '../services/workspaceLifecycle';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function reconcileOffMainThread(workspace: WorkspaceDocument, now: Date): Promise<ReconcileResult> {
  if (typeof Worker === 'undefined') return await Promise.race([Promise.resolve().then(() => reconcileRecurrences(clean(workspace), now)), new Promise<ReconcileResult>((_, reject) => window.setTimeout(() => reject(new Error('Recurrence reconciliation timed out')), 8_000))]);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../recurrence.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Recurrence worker timed out')); }, 8_000);
    worker.onmessage = (event: MessageEvent<{ ok: true; result: ReconcileResult } | { ok: false; error: string }>) => { window.clearTimeout(timeout); worker.terminate(); if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error)); };
    worker.onerror = () => { window.clearTimeout(timeout); worker.terminate(); reject(new Error('Recurrence worker failed')); };
    worker.postMessage({ workspace: clean(workspace), now: now.toISOString() });
  });
}

type Options = { onToast: (message: string) => void; setNotices: Dispatch<SetStateAction<AppNotice[]>> };

export function useWorkspaceController({ onToast, setNotices }: Options) {
  const [boot, setBoot] = useState<'checking' | 'empty' | 'locked' | 'ready'>('checking');
  const [session, setSession] = useState<UnlockedWorkspace | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const workspace = session?.document as WorkspaceDocument | undefined;

  useEffect(() => { void hasLocalWorkspace().then((exists) => setBoot(exists ? 'locked' : 'empty')); }, []);

  const commit = (message: string, mutation: (draft: WorkspaceDocument) => void): boolean => {
    if (!session) return false;
    const previous = session;
    let document: Automerge.Doc<WorkspaceDocument>;
    try { document = commitWorkspaceDocument(session.document as Automerge.Doc<WorkspaceDocument>, message, mutation); }
    catch (reason) { onToast(`Save failed; nothing was changed: ${reason instanceof Error ? reason.message : String(reason)}`); return false; }
    const next = { ...session, document }; setSession(next);
    saveQueue.current = saveQueue.current.then(() => saveLocalWorkspace(document, session.dataKey)).catch((reason) => { setSession((current) => current?.document === document ? previous : current); onToast(`Save failed; the change was reverted: ${String(reason)}`); });
    return true;
  };

  const activate = async (unlocked: UnlockedWorkspace, selectedLanguage?: WorkspaceLanguage) => {
    let notifications: Array<{ title: string; body: string; itemId?: string; reminderIds?: string[] }> = [];
    const now = effectiveWorkspaceNow(unlocked.document as WorkspaceDocument); const migration = migrateWorkspace(clean(unlocked.document as WorkspaceDocument));
    const migratedDocument = Automerge.change(unlocked.document, 'Migrate workspace metadata and reminders', (draft) => {
      const targetWorkspace = draft as unknown as WorkspaceDocument;
      if (targetWorkspace.schemaVersion !== migration.value.schemaVersion || !targetWorkspace.calendarPreferences?.language) { const target = targetWorkspace as unknown as Record<string, unknown>; Object.keys(target).forEach((key) => delete target[key]); Object.entries(migration.value as unknown as Record<string, unknown>).forEach(([key, value]) => { target[key] = clean(value); }); }
      if (selectedLanguage) targetWorkspace.calendarPreferences.language = selectedLanguage;
      backfillItemCreationVersions(targetWorkspace); Object.values(targetWorkspace.items).forEach(removeDuplicateReminders); consolidateHabitOccurrences(targetWorkspace, now);
    });
    let reconciliation: ReconcileResult; let warning = '';
    try { reconciliation = await reconcileOffMainThread(migratedDocument as WorkspaceDocument, now); }
    catch (reason) { reconciliation = { created: [], updated: [], autoClosed: [], removedIds: [], untouched: 0 }; warning = reason instanceof Error ? reason.message : String(reason); }
    let updated = applyReconciliationResult(migratedDocument as Automerge.Doc<WorkspaceDocument>, reconciliation, now, 'Unlock reconciliation');
    updated = Automerge.change(updated, 'Unlock scheduled events', (draft) => {
      const targetWorkspace = draft as unknown as WorkspaceDocument;
      const events: DomainEvent[] = reconciliation.created.map((item) => ({ id: createId(), type: 'occurrence.activated', at: now.toISOString(), itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }));
      events.push(...collectScheduledEvents(targetWorkspace, now)); notifications = runAutomationEvents(targetWorkspace, events, { now }).notifications;
    });
    const groups = new Map<string, { count: number; urgency: 'normal' | 'urgent' | 'critical'; reminderIds: string[] }>(); const rank = { normal: 0, urgent: 1, critical: 2 } as const;
    for (const item of Object.values(updated.items)) { if (item.state !== 'open' || item.role === 'series_template' || (item.schedule?.availableFrom && new Date(item.schedule.availableFrom) > now)) continue; for (const reminder of item.reminders) if (!reminder.acknowledgedAt && reminder.at && new Date(reminder.at) <= now) { const group = groups.get(item.id); if (!group) groups.set(item.id, { count: 1, urgency: reminder.urgency, reminderIds: [reminder.id] }); else { group.count += 1; group.reminderIds.push(reminder.id); if (rank[reminder.urgency] > rank[group.urgency]) group.urgency = reminder.urgency; } } }
    groups.forEach((group, itemId) => { const item = updated.items[itemId]; if (item) notifications.push({ title: item.title, body: `Reminder${group.count > 1 ? `s · ${group.count}` : ''} · ${group.urgency}`, itemId, reminderIds: group.reminderIds }); });
    await saveLocalWorkspace(updated, unlocked.dataKey); setSession({ ...unlocked, document: updated }); setBoot('ready');
    if (warning && !/timed out/i.test(warning)) onToast(`Workspace opened. Recurrence sync will retry in the background (${warning}).`);
    setNotices(notifications.map((notice) => ({ id: createId(), title: notice.title, body: notice.body, at: now.toISOString(), ...(notice.itemId ? { itemId: notice.itemId } : {}), ...(notice.reminderIds?.length ? { reminderIds: notice.reminderIds } : {}) })));
    if (Notification.permission === 'granted') notifications.forEach((notice) => new Notification(notice.title, { body: notice.body, ...(notice.itemId ? { tag: `reminder:${notice.itemId}` } : {}) }));
  };

  useEffect(() => {
    if (!workspace?.calendarPreferences.testClock?.enabled) return;
    let cancelled = false;
    const reconcile = () => { if (cancelled || !workspace) return; const now = effectiveWorkspaceNow(workspace); const result = reconcileRecurrences(clean(workspace), now); if (!result.created.length && !result.updated.length && !result.autoClosed.length && !result.removedIds.length) return; commit('Accelerated clock reconciliation', (draft) => { result.created.forEach((item) => { if (!draft.items[item.id]) draft.items[item.id] = clean(item); }); [...result.updated, ...result.autoClosed].forEach((item) => { draft.items[item.id] = clean(item); }); result.removedIds.forEach((id) => { draft.tombstones[id] = now.toISOString(); delete draft.items[id]; }); }); };
    const timer = window.setInterval(reconcile, 1_000); return () => { cancelled = true; window.clearInterval(timer); };
  }, [workspace?.calendarPreferences.testClock?.enabled, workspace?.updatedAt]);

  const lockWorkspace = () => { if (session) lock(session); setSession(null); setBoot('locked'); };
  const adoptSession = (next: UnlockedWorkspace, lockCurrent = false) => { if (lockCurrent && session) lock(session); setSession(next); setBoot('ready'); };
  return { boot, session, workspace, activate, commit, lockWorkspace, adoptSession };
}
