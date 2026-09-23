import { applyGoogleCalendarSync, googleCalendarEventToItem, GOOGLE_WRITE_BATCH_LIMIT, googleWriteLimitReached, recentGoogleWriteTimestamps, recordGoogleWrite, reconcileCalendarOrganization, reconcileRecurrences, updateRecurrenceCompletionTime, type GoogleCalendarEvent, type UniversalItem, type WorkspaceDocument, type RecurrenceCompletionRecord } from '@utm/core';
import { GOOGLE_SAVE_EXTENSION, saveGoogleItem, prepareGoogleSave, needsGoogleSave, type GoogleSaveOperation, type GoogleSaveOptions } from './googleItemSave';
import { GOOGLE_EDIT_EXTENSION, GoogleEditConflict, googleEventChanges, updateGoogleSeriesEvent, updateSingleGoogleEvent, moveSingleGoogleEvent, type GoogleEditOperation } from './googleCalendarEdit';
import { GOOGLE_CREATE_EXTENSION, type GoogleCreateOperation } from './googleCalendarCreate';
import { googleHistoryKey } from './googleHistoryKey';
import { cachedGoogleWriteToken, requestGoogleCalendarToken, synchronizeGoogleCalendars } from './googleCalendar';
import { googleActionItem } from '../features/items/editor/itemEditorSource';
import { saveItemInWorkspace, type ItemSaveIntent } from './itemSaveCommand';
import { GOOGLE_DELETION_RECEIPTS_EXTENSION, type GoogleDeletionReceipt } from '@utm/core';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fingerprint = (value: unknown): string | undefined => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
export interface WorkspaceSavePorts {
  getWorkspace: () => WorkspaceDocument | null;
  getSessionKey: () => object | null;
  commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => boolean;
  flushPersistence: () => Promise<void>;
  notify: (message: string) => void;
}

/** One coordinator per app instance. Every remote effect follows durable intent. */
export function createWorkspaceSaveService(ports: WorkspaceSavePorts) {
  const getWorkspace = () => ports.getWorkspace();
  const commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => ports.commit(message, mutation);
  const flushPersistence = () => ports.flushPersistence();
  const setToast = (message: string) => ports.notify(message);
  const requireWorkspace = () => { const current = getWorkspace(); if (!current) throw new Error('Workspace is locked.'); return current; };
  const googleWrites = new Set<string>();
  const localSaves = new Set<string>();
  const guard = () => {
    const workspace = requireWorkspace();
    const sessionKey = ports.getSessionKey();
    const connection = workspace.calendarPreferences.googleCalendar?.connectionId;
    const assertCurrent = () => {
      const current = getWorkspace();
      if (!sessionKey || ports.getSessionKey() !== sessionKey || current?.workspaceId !== workspace.workspaceId || current.calendarPreferences.googleCalendar?.connectionId !== connection) throw new Error('Workspace or Google connection changed.');
    };
    return {
      assertCurrent,
      commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => { assertCurrent(); return commit(message, mutation); },
      flushPersistence: async () => { assertCurrent(); await flushPersistence(); assertCurrent(); },
    };
  };
  const sendQueuedGoogleItem = async (candidate: UniversalItem, selection: GoogleSaveOptions, token: string) => {
    const { commit, flushPersistence, assertCurrent } = guard();
    const workspace = getWorkspace();
    const google = workspace?.calendarPreferences.googleCalendar;
    if (!workspace || !google || googleWrites.has(candidate.id)) return false;
    candidate = clean(workspace.items[candidate.id] ?? candidate);
    const occurrenceId = candidate.occurrence?.recurrenceId;
    let expectedOperation = fingerprint(candidate.extensions?.[GOOGLE_SAVE_EXTENSION]);
    const assertOperation = (draft: WorkspaceDocument) => {
      const target = draft.items[candidate.id];
      if (!target || target.deletedAt || target.occurrence?.recurrenceId !== occurrenceId || fingerprint(target.extensions?.[GOOGLE_SAVE_EXTENSION]) !== expectedOperation) throw new Error('Pending Google operation changed. Retry from the latest item.');
    };
    if (googleWriteLimitReached(google)) throw new Error(`Google write safety limit reached (${google.writeDailyLimit ?? 25} changes in 24 hours). The item remains saved in UTM.`);
    googleWrites.add(candidate.id);
    try {
      await saveGoogleItem({ token, workspaceId: workspace.workspaceId, accountEmail: google.accountEmail ?? '', item: candidate, options: selection, allowPast: google.allowPastEventEditing === true,
        persist: async (operation) => {
          assertCurrent();
          assertOperation(requireWorkspace());
          const ok = commit('Save pending Google operation', (draft) => { const target = draft.items[candidate.id]; if (!target || target.occurrence?.recurrenceId !== candidate.occurrence?.recurrenceId || draft.calendarPreferences.googleCalendar?.connectionId !== google.connectionId) throw new Error('Google connection changed.'); target.extensions ??= {}; target.extensions[GOOGLE_SAVE_EXTENSION] = clean(operation); });
          if (!ok) throw new Error('Could not persist Google operation.');
          expectedOperation = fingerprint(operation);
          await flushPersistence();
        },
        apply: async (calendarId, event, finished, nextOperation) => {
          assertCurrent();
          assertOperation(requireWorkspace());
          if (event.status === 'cancelled') {
            const ok = commit('Confirm Google event deletion', (draft) => {
              assertOperation(draft);
              reconcileCalendarOrganization(draft);
              const target = draft.items[candidate.id];
              if (!target || draft.calendarPreferences.googleCalendar?.connectionId !== google.connectionId) throw new Error('Google connection changed.');
              delete target.external;
              if (target.extensions) {
                const stored = target.extensions[GOOGLE_DELETION_RECEIPTS_EXTENSION];
                const receipts = (Array.isArray(stored) ? clean(stored) : []) as GoogleDeletionReceipt[];
                if (!receipts.some(receipt => receipt.calendarId === calendarId && receipt.eventId === event.id && receipt.accountEmail === google.accountEmail)) receipts.push({ calendarId, eventId: event.id, accountEmail: google.accountEmail ?? '', deletedAt: new Date().toISOString() });
                target.extensions[GOOGLE_DELETION_RECEIPTS_EXTENSION] = receipts;
                delete target.extensions[GOOGLE_SAVE_EXTENSION];
                delete target.extensions['utm:googleCreate'];
                delete target.extensions['utm:googleEdit'];
                delete target.extensions['utm:googleLinkKey'];
              }
              recordGoogleWrite(draft.calendarPreferences.googleCalendar!);
            });
            if (!ok) throw new Error('Could not persist Google deletion result.');
            await flushPersistence();
            return;
          }
          const key = await googleHistoryKey(calendarId, event.id);
          const ok = commit('Save linked Google event', (draft) => {
            assertOperation(draft);
            const target = draft.items[candidate.id]; if (!target || target.occurrence?.recurrenceId !== candidate.occurrence?.recurrenceId || draft.calendarPreferences.googleCalendar?.connectionId !== google.connectionId) throw new Error('Google connection changed.');
            const mirror = googleCalendarEventToItem(event, calendarId, google.connectionId, new Date().toISOString(), candidate.schedule?.timezone);
            if (!mirror?.external) throw new Error('Google returned an invalid event.');
            target.external = { ...mirror.external, readOnly: false }; target.extensions ??= {};
            target.extensions['utm:googleLinkKey'] = key;
            target.extensions[GOOGLE_CREATE_EXTENSION] = { eventId: event.id, calendarId, accountEmail: google.accountEmail ?? '' };
            const pending = target.extensions[GOOGLE_SAVE_EXTENSION] ? clean(target.extensions[GOOGLE_SAVE_EXTENSION]) : undefined;
            if (nextOperation) target.extensions[GOOGLE_SAVE_EXTENSION] = clean(nextOperation);
            else delete target.extensions[GOOGLE_SAVE_EXTENSION];
            applyGoogleCalendarSync(draft, { connectionId: google.connectionId, calendarId, events: [{ ...event, localHistoryKey: key }], syncedAt: new Date().toISOString(), fullSync: false });
            if (!finished && pending) target.extensions[GOOGLE_SAVE_EXTENSION] = pending;
            if (finished) recordGoogleWrite(draft.calendarPreferences.googleCalendar!);
            const calendar = draft.calendarPreferences.googleCalendar!.calendars.find((c) => c.id === calendarId); if (calendar) calendar.selected = true;
          });
          if (!ok) throw new Error('Could not persist Google result. Retry save to recover it.');
          expectedOperation = fingerprint(requireWorkspace().items[candidate.id]?.extensions?.[GOOGLE_SAVE_EXTENSION]);
          await flushPersistence();
        },
      });
      return true;
    } catch (reason) {
      const status = (reason as { status?: number }).status;
      const blocked = reason instanceof TypeError || status === 429 || (status !== undefined && status >= 500) || /network|fetch|timeout|timed out|write safety limit/i.test(String(reason)) ? undefined : String(reason);
      if (blocked && ports.getSessionKey() && getWorkspace()?.workspaceId === workspace.workspaceId) {
        const ok = commit('Google save needs attention', (draft) => {
          assertOperation(draft);
          const op = draft.items[candidate.id]?.extensions?.[GOOGLE_SAVE_EXTENSION] as unknown as GoogleSaveOperation | undefined;
          if (op) op.blocked = blocked;
        });
        if (!ok) throw new Error('Could not persist Google save status.');
        await flushPersistence();
      }
      throw reason;
    } finally { googleWrites.delete(candidate.id); }
  };
  const retryGoogleQueue = async (interactive = false, excludeId?: string, suppliedToken?: string) => {
    const { assertCurrent } = guard();
    const current = getWorkspace();
    if (!current?.calendarPreferences.googleCalendar) return 0;
    const queued = (item: UniversalItem) => !item.deletedAt && Boolean(item.extensions?.[GOOGLE_SAVE_EXTENSION] || (item.extensions?.[GOOGLE_EDIT_EXTENSION] as unknown as GoogleEditOperation | undefined)?.attempted);
    const queue = Object.values(current.items).filter(item => item.id !== excludeId && queued(item));
    if (!queue.length) return 0;
    const token = suppliedToken ?? (interactive ? (await requestGoogleCalendarToken(undefined, 'create')).accessToken : cachedGoogleWriteToken());
    if (!token) return queue.length;
    const batchLimit = current.calendarPreferences.googleCalendar.writeBatchLimit ?? GOOGLE_WRITE_BATCH_LIMIT;
    const dailyLimit = current.calendarPreferences.googleCalendar.writeDailyLimit ?? 25;
    const remainingToday = Math.max(0, dailyLimit - recentGoogleWriteTimestamps(current.calendarPreferences.googleCalendar).length);
    const releaseLimit = Math.min(batchLimit, remainingToday);
    if (interactive && queue.length > releaseLimit) setToast(current.calendarPreferences.language === 'ru' ? `Сейчас будет отправлено не больше ${releaseLimit} изменений. Остальные останутся в очереди из-за защитного лимита.` : `No more than ${releaseLimit} changes will be sent now. The rest remain queued by the safety limit.`);
    for (const item of queue.slice(0, releaseLimit)) {
      assertCurrent();
      if (googleWrites.has(item.id) || localSaves.has(item.id)) continue;
      const latest = requireWorkspace().items[item.id];
      if (!latest || !queued(latest)) continue;
      if (!latest.extensions?.[GOOGLE_SAVE_EXTENSION]) {
        const edit = latest.extensions?.[GOOGLE_EDIT_EXTENSION] as unknown as GoogleEditOperation;
        if (edit.accountEmail !== current.calendarPreferences.googleCalendar.accountEmail) continue;
        try { await saveGoogleEdit(item.id, clean(edit), token); } catch { /* Retain attempted intent for read-back recovery. */ }
        continue;
      }
      const op = latest.extensions![GOOGLE_SAVE_EXTENSION] as unknown as GoogleSaveOperation;
      if (op.blocked || op.accountEmail !== current.calendarPreferences.googleCalendar.accountEmail) continue;
      try { await sendQueuedGoogleItem(latest, { calendarId: op.destination, busy: op.draft.busy, baseline: latest }, token); }
      catch { /* The durable operation remains visible in the editor; no background popup. */ }
    }
    return Object.values(requireWorkspace().items).filter(item => item.id !== excludeId && queued(item)).length;
  };

  const persistGoogleEditDraft = async (itemId: string, operation: GoogleEditOperation | null) => {
    const { commit, flushPersistence } = guard();

    const saved = commit('Save Google event draft', (draft) => {
      const target = draft.items[itemId]; if (!target?.external) throw new Error('Google event no longer exists.');
      target.extensions ??= {};
      if (operation) target.extensions[GOOGLE_EDIT_EXTENSION] = clean(operation); else delete target.extensions[GOOGLE_EDIT_EXTENSION];
    });
    if (!saved) throw new Error('Could not save the event draft.');
    await flushPersistence();
  };

  const completeGoogleSeries = async (itemId: string, operation: GoogleEditOperation, token: string) => {
    const { commit, flushPersistence } = guard();
    const workspace = requireWorkspace();
    await refreshGoogle(token);

    const edited = workspace.items[itemId]!;
    const saved = commit('Update Google recurring series', (draft) => {
      const target = draft.items[edited.id];
      if (fingerprint(target?.extensions?.[GOOGLE_EDIT_EXTENSION]) !== fingerprint(operation)) throw new Error('Pending Google edit changed.');
      if (target?.extensions) delete target.extensions[GOOGLE_EDIT_EXTENSION];
      if (draft.calendarPreferences.googleCalendar) recordGoogleWrite(draft.calendarPreferences.googleCalendar);
    });
    if (!saved) throw new Error('Google saved the series; retry to refresh its local copy.');
    await flushPersistence();
  };

  const applyGoogleUpdated = async (itemId: string, event: GoogleCalendarEvent, calendarId: string, expected: GoogleEditOperation) => {
    const { commit, flushPersistence } = guard();
    const workspace = requireWorkspace();

    const before = workspace.items[itemId]?.external;
    const oldHistoryKey = before ? await googleHistoryKey(before.calendarId, before.eventId) : undefined;
    const newHistoryKey = await googleHistoryKey(calendarId, event.id);
    const saved = commit('Update Google event', (draft) => {
      const targetId = itemId;
      const target = draft.items[targetId];
      if (fingerprint(target?.extensions?.[GOOGLE_EDIT_EXTENSION]) !== fingerprint(expected)) throw new Error('Pending Google edit changed.');
      const external = target?.external;
      if (!external || draft.calendarPreferences.googleCalendar?.connectionId !== external.connectionId) throw new Error('Google connection changed.');
      if (calendarId !== external.calendarId) {
        if (external.readOnly) {
          const mirror = googleCalendarEventToItem(event, calendarId, external.connectionId, new Date().toISOString(), target.schedule?.timezone);
          if (!mirror) throw new Error('Google returned an invalid moved event.');
          draft.items[mirror.id] = { ...clean(target), id: mirror.id, external: clean(mirror.external!) };
          delete draft.items[targetId]; delete draft.tombstones[targetId];
          for (const candidate of Object.values(draft.items)) for (const relation of candidate.relations) if (relation.targetId === targetId) relation.targetId = mirror.id;
          for (const view of Object.values(draft.views)) {
            if (view.statistics) view.statistics.reservedItemIds = view.statistics.reservedItemIds.map(id => id === targetId ? mirror.id : id);
            const order = view.extensions?.['utm:manualOrder'];
            if (Array.isArray(order)) view.extensions!['utm:manualOrder'] = order.map(id => id === targetId ? mirror.id : id);
          }
        } else {
          external.calendarId = calendarId; external.eventId = event.id;
          const created = target.extensions?.[GOOGLE_CREATE_EXTENSION] as { calendarId?: string; eventId?: string } | undefined;
          if (created) { created.calendarId = calendarId; created.eventId = event.id; }
        }
      }
      if (oldHistoryKey && oldHistoryKey !== newHistoryKey && draft.calendarPreferences.localTimeJournals?.[oldHistoryKey] && !draft.calendarPreferences.localTimeJournals[newHistoryKey]) draft.calendarPreferences.localTimeJournals[newHistoryKey] = clean(draft.calendarPreferences.localTimeJournals[oldHistoryKey]);
      applyGoogleCalendarSync(draft, { connectionId: external.connectionId, calendarId, events: [{ ...event, localHistoryKey: newHistoryKey }], syncedAt: new Date().toISOString(), fullSync: false });
      recordGoogleWrite(draft.calendarPreferences.googleCalendar!);
      for (const candidate of Object.values(draft.items)) if (candidate.external?.connectionId === external.connectionId && candidate.external.calendarId === calendarId && candidate.external.eventId === event.id && candidate.extensions) delete candidate.extensions[GOOGLE_EDIT_EXTENSION];
    });
    if (!saved) throw new Error('Google saved the event; retry to restore its local copy.');
    await flushPersistence();
  };

  const prepareGoogleCreate = async (itemId: string, operation: GoogleCreateOperation) => {
    const { commit, flushPersistence } = guard();

    const saved = commit('Prepare Google Calendar creation', (draft) => {
      const target = draft.items[itemId];
      if (!target || target.deletedAt) throw new Error('Save the item before creating a Google event.');
      const previous = target.extensions?.[GOOGLE_CREATE_EXTENSION];
      const stable = fingerprint;
      if (previous && stable(previous) !== stable(operation)) throw new Error('A Google creation operation already exists for this item.');
      target.extensions = { ...target.extensions, [GOOGLE_CREATE_EXTENSION]: clean(operation) };
    });
    if (!saved) throw new Error('Could not save the Google creation operation.');
    await flushPersistence();
  };

  const applyGoogleCreated = async (itemId: string, operation: GoogleCreateOperation, event: GoogleCalendarEvent) => {
    const { commit, flushPersistence } = guard();

    let linkedItem: UniversalItem | undefined;
    const localHistoryKey = await googleHistoryKey(operation.calendarId, event.id);
    const saved = commit('Import created Google event', (draft) => {
      const google = draft.calendarPreferences.googleCalendar;
      if (!google || google.accountEmail !== operation.accountEmail) throw new Error('Google connection changed. Reconnect the original account and retry.');
      applyGoogleCalendarSync(draft, { connectionId: google.connectionId, calendarId: operation.calendarId, events: [{ ...event, localHistoryKey }], syncedAt: new Date().toISOString(), fullSync: false });
      recordGoogleWrite(google);
      linkedItem = clean(draft.items[itemId]);
      const calendar = google.calendars.find((entry) => entry.id === operation.calendarId);
      if (calendar) calendar.selected = true;
      else google.calendars.push({ id: operation.calendarId, name: operation.calendarId, selected: true });
    });
    if (!saved) throw new Error('Google event created; retry to restore its local copy.');
    await flushPersistence();
    return linkedItem;
  };

  const refreshGoogle = async (suppliedToken: string, progress?: Parameters<typeof synchronizeGoogleCalendars>[2]) => {
    const { commit, flushPersistence } = guard();
    const current = requireWorkspace();
    const google = current.calendarPreferences.googleCalendar;
    if (!google) throw new Error('Google connection changed.');
    const result = await synchronizeGoogleCalendars(suppliedToken, google, progress);
    if (!commit('Sync Google Calendar', draft => {
      if (draft.calendarPreferences.googleCalendar?.connectionId !== google.connectionId) throw new Error('Google connection changed.');
      for (const batch of result.batches) applyGoogleCalendarSync(draft, batch);
      draft.calendarPreferences.googleCalendar = { ...clean(draft.calendarPreferences.googleCalendar), calendars: clean(result.calendars), syncTokens: clean(result.syncTokens), syncWindow: clean(result.syncWindow), lastSyncedAt: result.syncedAt, ...(result.accountEmail ? { accountEmail: result.accountEmail } : {}) };
      delete draft.calendarPreferences.googleCalendar.lastError;
      reconcileCalendarOrganization(draft);
    })) throw new Error('Could not persist Google series refresh.');
    await flushPersistence();
    return result;
  };
  const synchronize = async (token: string, progress?: Parameters<typeof synchronizeGoogleCalendars>[2]) => {
    const { assertCurrent, commit, flushPersistence } = guard();
    try {
      const queuedGoogleWrites = await retryGoogleQueue(false, undefined, token);
      assertCurrent();
      const result = await refreshGoogle(token, progress);
      return { result, queuedGoogleWrites };
    } catch (reason) {
      // An old session must not even write error metadata into the new workspace.
      assertCurrent();
      if (commit('Record Google Calendar sync error', draft => {
        if (draft.calendarPreferences.googleCalendar) draft.calendarPreferences.googleCalendar.lastError = reason instanceof Error ? reason.message : String(reason);
      })) await flushPersistence();
      throw reason;
    }
  };
  const saveGoogleEdit = async (itemId: string, operation: GoogleEditOperation, suppliedToken?: string) => {
    if (googleWrites.has(itemId)) throw new Error('Google synchronization for this item is still running.');
    const { assertCurrent } = guard();
    const workspace = requireWorkspace();
    const google = workspace.calendarPreferences.googleCalendar;
    if (!google || google.accountEmail !== operation.accountEmail) throw new Error('Google connection changed.');
    if (googleWriteLimitReached(google)) throw new Error('Google write safety limit reached.');
    googleEventChanges(operation);
    googleWrites.add(itemId);
    try {
      const attempted = { ...operation, attempted: true };
      await persistGoogleEditDraft(itemId, attempted);
      const token = suppliedToken ?? (await requestGoogleCalendarToken(undefined, 'create')).accessToken;
      assertCurrent();
      const event = operation.scope === 'series'
        ? await updateGoogleSeriesEvent(token, operation)
        : await updateSingleGoogleEvent(token, operation, Date.now, google.allowPastEventEditing);
      assertCurrent();
      if (fingerprint(requireWorkspace().items[itemId]?.extensions?.[GOOGLE_EDIT_EXTENSION]) !== fingerprint(attempted)) throw new Error('Pending Google edit changed.');
      if (operation.scope === 'series') await completeGoogleSeries(itemId, attempted, token);
      else {
        const moved = await moveSingleGoogleEvent(token, attempted, event);
        assertCurrent();
        await applyGoogleUpdated(itemId, moved.event, moved.calendarId, attempted);
      }
    } finally { googleWrites.delete(itemId); }
  };
  const saveItem = async (item: UniversalItem, options: ItemSaveIntent | undefined, now: Date) => {
    if (googleWrites.has(item.id) || localSaves.has(item.id)) throw new Error('This item is already being saved. Your draft is kept here.');
    const { commit, flushPersistence, assertCurrent } = guard();
    const workspace = requireWorkspace();
    localSaves.add(item.id);
    try {
      let result: ReturnType<typeof saveItemInWorkspace> | undefined;
      if (!commit(workspace.items[item.id] ? 'Update item' : 'Create item', draft => { result = saveItemInWorkspace(draft, item, options, now); }) || !result) throw new Error('Could not save item.');
      const { googleCandidate: candidate, recurrenceError } = result;
      const google = workspace.calendarPreferences.googleCalendar;
      let selection: GoogleSaveOptions | undefined;
      if (options?.google && google && candidate.role !== 'series_template' && !item.extensions?.['utm:template']) {
        selection = { ...options.google, baseline: item.role === 'series_template' ? clean(googleActionItem(workspace, options.google.baseline)) : options.google.baseline };
        if (needsGoogleSave(candidate, selection)) {
          if (!selection.calendarId) throw new Error('Choose a Google calendar.');
          const operation = await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: google.accountEmail ?? '', item: candidate, options: selection });
          if (!commit('Queue Google save locally', draft => {
            const target = draft.items[candidate.id];
            if (!target || target.deletedAt) throw new Error('Item no longer exists.');
            target.extensions ??= {}; target.extensions[GOOGLE_SAVE_EXTENSION] = clean(operation);
          })) throw new Error('Could not persist pending Google operation.');
        } else selection = undefined;
      }
      await flushPersistence();
      if (selection) {
        try {
          const token = await requestGoogleCalendarToken(undefined, 'create');
          assertCurrent();
          await sendQueuedGoogleItem(candidate, selection, token.accessToken);
        } catch (reason) {
          if (reason instanceof GoogleEditConflict || /persist|storage|indexeddb|connection changed/i.test(String(reason))) throw reason;
          return { recurrenceError, pendingGoogle: true };
        }
      }
      return { recurrenceError, pendingGoogle: false };
    } finally {
      localSaves.delete(item.id);
      if (!options?.google && ports.getSessionKey()) void retryGoogleQueue(false, options?.deleteGoogleEvent ? undefined : item.id).catch(() => undefined);
    }
  };
  const updateSeriesCompletion = (record: RecurrenceCompletionRecord, completedAt: string, now: Date) => {
    let result = { changed: false, rescheduled: false };
    let series: UniversalItem | undefined;
    if (!commit('Change recurring completion time', draft => {
      result = updateRecurrenceCompletionTime(draft, record, completedAt, now);
      if (result.changed) reconcileRecurrences(draft, now);
      const updated = draft.items[record.seriesId]; if (updated) series = clean(updated);
    })) throw new Error('Could not save recurring completion.');
    return { series, ...result };
  };
  return { saveItem, updateSeriesCompletion, synchronize, retryGoogleQueue, persistGoogleEditDraft, saveGoogleEdit, prepareGoogleCreate, applyGoogleCreated, isWriting: (id: string) => googleWrites.has(id) || localSaves.has(id) };
}
