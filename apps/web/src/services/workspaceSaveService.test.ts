import * as Automerge from '@automerge/automerge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGoogleCalendarSync, createItem, createWorkspace, reconcileCalendarOrganization, type GoogleCalendarEvent, type WorkspaceDocument } from '@utm/core';
import { createAutomergeDocument } from '@utm/sdk';
import { createWorkspaceSaveService } from './workspaceSaveService';
import { commitWorkspaceDocument } from './workspaceLifecycle';
import { googleEventDraft, type GoogleEditOperation } from './googleCalendarEdit';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('./googleCalendar', async importOriginal => ({
  ...await importOriginal<typeof import('./googleCalendar')>(),
  requestGoogleCalendarToken: vi.fn(async () => ({ accessToken: 'test' })),
  cachedGoogleWriteToken: () => 'test',
  synchronizeGoogleCalendars: refresh,
}));
afterEach(() => { vi.unstubAllGlobals(); refresh.mockReset(); });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const account = 'test@example.invalid';

function fixture(linked = false) {
  const workspace = createWorkspace('Synthetic crash recovery');
  workspace.calendarPreferences.googleCalendar = { connectionId: 'connection', accountEmail: account, calendars: [{ id: account, name: 'Test', selected: true }], syncTokens: {} };
  const item = createItem('Synthetic item');
  item.schedule = { startAt: '2099-09-20T12:00:00.000Z', endAt: '2099-09-20T12:45:00.000Z', dueAt: '2099-09-24T12:00:00.000Z', estimatedDuration: 'PT45M', timezone: 'UTC' };
  if (linked) item.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: account, eventId: 'utm12345', etag: 'v1', readOnly: false, sourceUrl: '', syncedAt: '2099-09-20T00:00:00.000Z', startAt: item.schedule.startAt!, endAt: item.schedule.endAt! };
  workspace.items[item.id] = item;
  reconcileCalendarOrganization(workspace);
  return { workspace, item };
}

/** Discard all volatile state and restore only the last durable Automerge bytes. */
function app(initial: WorkspaceDocument) {
  let doc = createAutomergeDocument(initial);
  let disk = Automerge.save(doc);
  let session: object | null = {};
  let lastCommit = '';
  let crashAt = '';
  const ports = {
    getWorkspace: () => session ? doc as WorkspaceDocument : null,
    getSessionKey: () => session,
    notify: vi.fn(),
    commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => { doc = commitWorkspaceDocument(doc, message, mutation); lastCommit = message; return true; },
    flushPersistence: async () => {
      if (crashAt === lastCommit) { session = null; throw new Error('IndexedDB acknowledgement interrupted by app closure'); }
      disk = Automerge.save(doc);
    },
  };
  let service = createWorkspaceSaveService(ports);
  return {
    get service() { return service; }, get workspace() { return doc; },
    crashBeforeAck(message: string) { crashAt = message; },
    reload() { doc = Automerge.load<WorkspaceDocument>(disk); session = {}; crashAt = ''; service = createWorkspaceSaveService(ports); },
    close() { session = null; },
    commit: ports.commit,
  };
}

function remote(initial?: GoogleCalendarEvent) {
  let event = initial;
  let creates = 0, deletes = 0, patches = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('calendarList')) return Response.json({ items: [{ id: account, primary: true, accessRole: 'owner', timeZone: 'UTC' }] });
    if (init?.method === 'DELETE') {
      if (!event) return Response.json({}, { status: 410 });
      deletes++; event = undefined; return new Response(null, { status: 204 });
    }
    if (init?.method === 'POST') {
      if (event) return Response.json({}, { status: 409 });
      creates++; event = { ...JSON.parse(init.body as string), etag: 'v1' }; return Response.json(event);
    }
    if (init?.method === 'PATCH') {
      patches++; event = { ...event!, ...JSON.parse(init.body as string), etag: 'v2' }; return Response.json(event);
    }
    return event ? Response.json(event) : Response.json({}, { status: 404 });
  }));
  return { get event() { return event; }, get effects() { return { creates, deletes, patches }; } };
}

describe('workspace save coordinator crash recovery', () => {
  it('recovers a remotely created event after losing the local acknowledgement', async () => {
    const { workspace, item } = fixture(); const runtime = app(workspace); const google = remote();
    runtime.crashBeforeAck('Save linked Google event');
    await expect(runtime.service.saveItem(item, { google: { calendarId: account, busy: true, baseline: item } }, new Date())).rejects.toThrow('IndexedDB');
    expect(google.effects.creates).toBe(1);
    runtime.reload();
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:googleSave']).toBeDefined();
    await runtime.service.retryGoogleQueue(false, undefined, 'test');
    runtime.reload();
    expect(Object.keys(runtime.workspace.items)).toEqual([item.id]);
    expect(runtime.workspace.items[item.id]!.external?.eventId).toBe(google.event!.id);
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:googleSave']).toBeUndefined();
    expect(google.effects.creates).toBe(1);
  });

  it('recovers deletion after acknowledgement loss without restoring end, tag or changing duration', async () => {
    const { workspace, item } = fixture(true); const runtime = app(workspace);
    const stale: GoogleCalendarEvent = { id: item.external!.eventId, summary: item.title, start: { dateTime: item.schedule!.startAt! }, end: { dateTime: item.schedule!.endAt! } };
    const google = remote(stale);
    const edited = copy(item); delete edited.schedule!.endAt;
    // Save the local intent; exercise the queue explicitly after the automatic retry.
    runtime.crashBeforeAck('Confirm Google event deletion');
    await runtime.service.saveItem(edited, { deleteGoogleEvent: true }, new Date());
    await vi.waitFor(() => expect(google.effects.deletes).toBe(1));
    await vi.waitFor(() => expect(runtime.service.isWriting(item.id)).toBe(false));
    runtime.reload();
    for (let n = 0; n < 2; n++) runtime.commit('Stale incoming sync', draft => applyGoogleCalendarSync(draft, { calendarId: account, connectionId: 'connection', syncedAt: '2099-09-21T00:00:00Z', fullSync: false, events: [stale] }));
    await runtime.service.retryGoogleQueue(false, undefined, 'test');
    runtime.reload();
    const withoutReceipt = copy(runtime.workspace.items[item.id]!);
    delete withoutReceipt.extensions!['utm:googleDeletionReceipts'];
    await runtime.service.saveItem(withoutReceipt, undefined, new Date());
    runtime.reload();
    runtime.commit('Delayed stale sync after acknowledgement', draft => applyGoogleCalendarSync(draft, { calendarId: account, connectionId: 'connection', syncedAt: '2099-09-21T00:00:00Z', fullSync: false, events: [stale] }));
    const saved = runtime.workspace.items[item.id]!;
    expect(Object.keys(runtime.workspace.items)).toEqual([item.id]);
    expect(saved.external).toBeUndefined(); expect(saved.schedule?.endAt).toBeUndefined();
    expect(saved.schedule?.estimatedDuration).toBe('PT45M'); expect(saved.tags).not.toContain('C.Test');
    expect(saved.extensions?.['utm:googleSave']).toBeUndefined(); expect(google.effects.deletes).toBe(1);
  });

  it.each(['occurrence', 'series'] as const)('recovers %s edits by read-back without applying the time shift twice', async scope => {
    const { workspace, item } = fixture(true); const runtime = app(workspace);
    const event: GoogleCalendarEvent = { id: item.external!.eventId, etag: 'v1', summary: item.title, start: { dateTime: item.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: item.schedule!.endAt!, timeZone: 'UTC' }, ...(scope === 'series' ? { recurrence: ['RRULE:FREQ=WEEKLY', 'EXDATE:20991001T120000Z'] } : {}) };
    const google = remote(event);
    refresh.mockImplementation(async () => ({ calendars: workspace.calendarPreferences.googleCalendar!.calendars, syncTokens: {}, syncWindow: { timeMin: '2099-09-01T00:00:00Z', timeMax: '2099-10-01T00:00:00Z', refreshedAt: '2099-09-21T00:00:00Z' }, syncedAt: '2099-09-21T00:00:00Z', batches: [{ calendarId: account, connectionId: 'connection', syncedAt: '2099-09-21T00:00:00Z', fullSync: false, events: [google.event] }] }));
    const operation: GoogleEditOperation = { calendarId: account, eventId: event.id, accountEmail: account, baseline: event, draft: { ...googleEventDraft(event, 'UTC'), start: '2099-09-20T13:00:00Z', end: '2099-09-20T13:45:00Z' }, scope };
    runtime.crashBeforeAck(scope === 'series' ? 'Update Google recurring series' : 'Update Google event');
    await expect(runtime.service.saveGoogleEdit(item.id, operation, 'test')).rejects.toThrow('IndexedDB');
    runtime.reload();
    await runtime.service.retryGoogleQueue(false, undefined, 'test'); runtime.reload();
    expect(google.effects.patches).toBe(1); expect(google.event!.start!.dateTime).toBe('2099-09-20T13:00:00.000Z');
    expect(google.event!.recurrence).toEqual(event.recurrence);
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:googleEdit']).toBeUndefined();
    expect(runtime.workspace.items[item.id]!.external?.startAt).toBe('2099-09-20T13:00:00.000Z');
    expect(Object.keys(runtime.workspace.items)).toEqual([item.id]);
  });

  it('rejects a second Save while the first waits for persistence', async () => {
    const { workspace, item } = fixture();
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const session = {}; let doc = copy(workspace);
    const service = createWorkspaceSaveService({ getWorkspace: () => doc, getSessionKey: () => session, notify: () => {}, commit: (_message, mutate) => { mutate(doc); return true; }, flushPersistence: () => wait });
    const first = service.saveItem(item, undefined, new Date());
    await expect(service.saveItem(item, undefined, new Date())).rejects.toThrow('already being saved');
    release(); await first; expect(Object.keys(doc.items)).toEqual([item.id]);
  });

  it('does not send a remote write when persisting the initial intent fails', async () => {
    const { workspace, item } = fixture(); const runtime = app(workspace); const google = remote();
    runtime.crashBeforeAck('Queue Google save locally');
    await expect(runtime.service.saveItem(item, { google: { calendarId: account, busy: true, baseline: item } }, new Date())).rejects.toThrow('IndexedDB');
    expect(google.effects).toEqual({ creates: 0, deletes: 0, patches: 0 });
    runtime.reload();
    expect(runtime.workspace.items[item.id]!.external).toBeUndefined();
  });

  it('refreshes calendar metadata after a write without reassigning Automerge proxies', async () => {
    const { workspace, item } = fixture(); const runtime = app(workspace); remote();
    await runtime.service.saveItem(item, { google: { calendarId: account, busy: true, baseline: item } }, new Date());
    refresh.mockResolvedValue({ calendars: [{ id: account, name: 'Renamed', selected: true }], syncTokens: {}, syncWindow: { timeMin: '2099-09-01T00:00:00Z', timeMax: '2099-10-01T00:00:00Z', refreshedAt: '2099-09-21T00:00:00Z' }, syncedAt: '2099-09-21T00:00:00Z', batches: [] });
    await runtime.service.synchronize('test'); runtime.reload();
    expect(runtime.workspace.calendarPreferences.googleCalendar?.calendars[0]?.name).toBe('Renamed');
    expect(Object.keys(runtime.workspace.items)).toEqual([item.id]);
  });

  it('does not write a delayed sync error into a reopened workspace', async () => {
    const { workspace } = fixture(); const runtime = app(workspace);
    let reject!: (reason: Error) => void;
    refresh.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const synchronization = runtime.service.synchronize('test');
    const rejected = expect(synchronization).rejects.toThrow('changed');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    runtime.close(); runtime.reload(); reject(new Error('network failed')); await rejected;
    expect(runtime.workspace.calendarPreferences.googleCalendar?.lastError).toBeUndefined();
  });

  it('ignores an old-session response after close and reopen, then recovers the same remote identity', async () => {
    const { workspace, item } = fixture(); const runtime = app(workspace); const google = remote();
    const fetchRemote = fetch;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const response = await fetchRemote(url, init);
      if (init?.method === 'POST') await wait;
      return response;
    }));
    const oldSave = runtime.service.saveItem(item, { google: { calendarId: account, busy: true, baseline: item } }, new Date());
    const rejected = expect(oldSave).rejects.toThrow('changed');
    await vi.waitFor(() => expect(google.effects.creates).toBe(1));
    runtime.close(); runtime.reload(); release(); await rejected;
    expect(runtime.workspace.items[item.id]!.external).toBeUndefined();
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:googleSave']).toBeDefined();
    await runtime.service.retryGoogleQueue(false, undefined, 'test'); runtime.reload();
    expect(runtime.workspace.items[item.id]!.external?.eventId).toBe(google.event!.id);
    expect(google.effects.creates).toBe(1); expect(Object.keys(runtime.workspace.items)).toEqual([item.id]);
  });
});
