import * as Automerge from '@automerge/automerge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGoogleCalendarSync, createItem, createOccurrence, createWorkspace, reconcileCalendarOrganization, type GoogleCalendarEvent, type WorkspaceDocument } from '@utm/core';
import { itemEditorSource } from '../features/items/editor/itemEditorSource';
import { prepareGoogleSave } from './googleItemSave';
import { googleCreationId } from './googleCalendarCreate';
import { createAutomergeDocument } from '@utm/sdk';
import { createWorkspaceSaveService } from './workspaceSaveService';
import { commitWorkspaceDocument } from './workspaceLifecycle';
import { googleEventDraft, type GoogleEditOperation } from './googleCalendarEdit';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('./googleSyncWorker', async importOriginal => ({
  ...await importOriginal<typeof import('./googleSyncWorker')>(),
  planGoogleSync: async (input: import('./googleSyncPlan').GoogleSyncPlanInput) => (await import('./googleSyncPlan')).calculateGoogleSyncPlan(input),
}));
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

it('restores missing Sunday instances after a failed import without remote writes', async () => {
  const { workspace, item } = fixture();
  workspace.calendarPreferences.googleCalendar!.lastError = 'Previous import failed';
  workspace.calendarPreferences.googleCalendar!.syncTokens = { [account]: 'old-cursor' };
  const runtime = app(workspace);
  const google = remote();
  const events: GoogleCalendarEvent[] = ['2026-10-04', '2026-10-11', '2026-10-18'].map(date => ({
    id: `weekly_${date}`, recurringEventId: 'weekly', summary: 'Sunday',
    originalStartTime: { dateTime: `${date}T08:00:00Z` },
    start: { dateTime: `${date}T08:00:00Z` }, end: { dateTime: `${date}T09:30:00Z` },
  }));
  refresh.mockResolvedValue({ calendars: workspace.calendarPreferences.googleCalendar!.calendars, syncTokens: { [account]: 'new-cursor' }, syncWindow: { timeMin: '2026-09-01T00:00:00Z', timeMax: '2027-01-01T00:00:00Z', refreshedAt: '2026-09-28T00:00:00Z' }, syncedAt: '2026-09-28T00:00:00Z', batches: [{ calendarId: account, connectionId: 'connection', syncedAt: '2026-09-28T00:00:00Z', fullSync: true, events }] });
  await runtime.service.synchronize('test'); runtime.reload();
  expect(refresh.mock.calls[0]![3]).toEqual({ fullSync: true });
  expect(Object.values(runtime.workspace.items).filter(entry => entry.external?.provider === 'google_calendar')).toHaveLength(3);
  expect(runtime.workspace.items[item.id]!.title).toBe(item.title);
  expect(runtime.workspace.calendarPreferences.googleCalendar!.lastError).toBeUndefined();
  expect(runtime.workspace.calendarPreferences.googleCalendar!.syncTokens[account]).toBe('new-cursor');
  expect(google.effects).toEqual({ creates: 0, deletes: 0, patches: 0 });
});

it('rejects overlapping sync and releases its lock after failure', async () => {
  const runtime = app(fixture().workspace);
  let reject!: (error: Error) => void;
  refresh.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const first = runtime.service.synchronize('test');
  const failed = expect(first).rejects.toThrow('network');
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await expect(runtime.service.synchronize('test')).rejects.toThrow('already running');
  reject(new Error('network'));
  await failed;
  refresh.mockRejectedValue(new Error('network again'));
  await expect(runtime.service.synchronize('test')).rejects.toThrow('network again');
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('recovers an unlinked future split by its verified creation ID after manual sync, retaining UTM history', async () => {
  const { workspace, item } = fixture();
  item.role = 'series_template';
  item.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, rdates: [], exdates: [] };
  item.recurrenceOverride = { kind: 'future_split', sourceSeriesId: 'old', recurrenceId: item.schedule!.startAt! };
  const cycle = createOccurrence(item, new Date(item.schedule!.startAt!), 0);
  cycle.actualTimeEntries = [{ id: 'keep', durationSeconds: 300, source: 'manual', comment: 'Keep history' }];
  workspace.items[cycle.id] = cycle;
  const id = await googleCreationId(workspace.workspaceId, item.id);
  const master: GoogleCalendarEvent = { id, summary: 'Updated Google title', etag: 'v2', recurrence: ['RRULE:FREQ=WEEKLY'], start: { dateTime: item.schedule!.startAt! }, end: { dateTime: item.schedule!.endAt! }, extendedProperties: { private: { utmCreateOperation: id } } };
  const instance = { ...master, id: `${id}_20990920T120000Z`, recurringEventId: id, originalStartTime: master.start! };
  delete instance.recurrence;
  const batch = { connectionId: 'connection', calendarId: 'M', syncedAt: '2099-09-20T00:00:00Z', fullSync: false, events: [instance] };
  workspace.calendarPreferences.googleCalendar!.calendars.push({ id: 'M', name: 'M', selected: true });
  applyGoogleCalendarSync(workspace, batch);
  const mirror = Object.values(workspace.items).find(entry => entry.external?.readOnly)!;
  delete mirror.extensions!['utm:googleOccurrenceIdentity']; delete mirror.extensions!['utm:googleIdentityVersion'];
  refresh.mockResolvedValue({ calendars: workspace.calendarPreferences.googleCalendar!.calendars, syncTokens: {}, syncWindow: { timeMin: '2099-09-01T00:00:00Z', timeMax: '2099-10-01T00:00:00Z', refreshedAt: batch.syncedAt }, syncedAt: batch.syncedAt, batches: [batch] });
  const api = remote(master); const runtime = app(workspace);
  await runtime.service.synchronize('test'); runtime.reload();
  expect(runtime.workspace.items[item.id]!.external?.calendarId).toBe('M');
  expect(runtime.workspace.items[cycle.id]!.title).toBe(master.summary);
  expect(runtime.workspace.items[cycle.id]!.actualTimeEntries).toHaveLength(1);
  expect(Object.values(runtime.workspace.items).filter(entry => entry.external?.readOnly)).toHaveLength(0);
  expect(api.effects).toEqual({ creates: 0, deletes: 0, patches: 0 });
});

describe('workspace save coordinator crash recovery', () => {
  it('returns after durable local save without waiting for Google response', async () => {
    const { workspace, item } = fixture(true);
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
    const runtime = app(workspace);
    const edited = copy(item); edited.title = 'Saved offline';
    const result = await runtime.service.saveItem(edited, { google: { calendarId: account, busy: true, baseline: item } }, new Date(), true);
    expect(result.pendingGoogle).toBe(true);
    expect(runtime.workspace.items[item.id]!.title).toBe('Saved offline');
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:googleSave']).toBeTruthy();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    runtime.close(); // Late responses may not update a closed workspace.
    release(Response.json({}, { status: 503 }));
  });
  it('keeps deletion durable after a lost response and finishes it after reload', async () => {
    const { workspace, item } = fixture(true);
    const api = remote({ id: item.external!.eventId, etag: 'v1', start: { dateTime: item.schedule!.startAt! }, end: { dateTime: item.schedule!.endAt! } });
    const realFetch = globalThis.fetch;
    let interrupted = false;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const result = await realFetch(url, init);
      if (init?.method === 'DELETE' && !interrupted) { interrupted = true; throw new TypeError('Network response lost'); }
      return result;
    });
    const runtime = app(workspace);
    await expect(runtime.service.deleteItem(item.id)).rejects.toThrow('lost');
    expect(runtime.workspace.items[item.id]!.deletedAt).toBeUndefined();
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:itemDelete']).toBeTruthy();
    runtime.reload();
    await runtime.service.retryGoogleQueue(false, undefined, 'test');
    expect(runtime.workspace.items[item.id]!.deletedAt).toBeTruthy();
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:itemDelete']).toBeUndefined();
    expect(api.effects.deletes).toBe(1);
  });
  it('does not send deletion before its durable acknowledgement', async () => {
    const { workspace, item } = fixture(true); const api = remote({ id: item.external!.eventId });
    const runtime = app(workspace); runtime.crashBeforeAck('Queue scoped item deletion');
    await expect(runtime.service.deleteItem(item.id)).rejects.toThrow('IndexedDB');
    expect(api.effects.deletes).toBe(0);
  });
  it('waits for an in-flight occurrence write before applying the newer editor title', async () => {
    const { workspace, item: series } = fixture();
    series.role = 'series_template';
    series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=3', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'PT0M', rdates: [], exdates: [] };
    const occurrence = createOccurrence(series, new Date(series.schedule!.startAt!), 0);
    occurrence.external = { provider: 'google_calendar', connectionId: 'connection', calendarId: account, eventId: 'instance', etag: 'v1', readOnly: false, sourceUrl: '', syncedAt: '' };
    const baseline = copy(occurrence); occurrence.title = 'Queued title';
    occurrence.extensions = { 'utm:googleSave': await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: account, item: occurrence, options: { calendarId: account, busy: true, baseline } }) };
    workspace.items[occurrence.id] = occurrence;
    const google = remote({ id: 'instance', etag: 'v1', summary: baseline.title, start: { dateTime: occurrence.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: occurrence.schedule!.endAt!, timeZone: 'UTC' } });
    const fetchRemote = fetch; let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const response = await fetchRemote(url, init);
      if (init?.method === 'PATCH') await wait;
      return response;
    }));
    const runtime = app(workspace);
    const background = runtime.service.retryGoogleQueue(false, undefined, 'test');
    await vi.waitFor(() => expect(google.effects.patches).toBe(1));
    const edited = copy(itemEditorSource(workspace, occurrence)); edited.title = 'Latest title';
    const saving = runtime.service.saveItem(edited, { recurrenceEdit: { occurrenceId: occurrence.id, scope: 'this_occurrence' }, google: { calendarId: account, busy: true, baseline: edited } }, new Date());
    expect(runtime.workspace.items[occurrence.id]!.title).toBe('Queued title');
    release(); await background; await saving; runtime.reload();
    expect(runtime.workspace.items[occurrence.id]!.title).toBe('Latest title');
    expect(google.event?.summary).toBe('Latest title'); expect(google.effects.patches).toBe(2);
  });
  it.each([false, true])('finishes a blocked master before saving an occurrence (background=%s)', async background => {
    const { workspace, item: series } = fixture();
    series.role = 'series_template';
    series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=3', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'PT0M', rdates: [], exdates: [] };
    const occurrence = createOccurrence(series, new Date(series.schedule!.startAt!), 0);
    workspace.items[occurrence.id] = occurrence;
    series.extensions = { 'utm:googleSave': await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: account, item: series, options: { calendarId: account, busy: true, baseline: series } }) };
    (series.extensions['utm:googleSave'] as { blocked?: string }).blocked = 'Previous attempt failed';
    let master: GoogleCalendarEvent | undefined;
    let instance: GoogleCalendarEvent = { id: 'instance', etag: 'v1', summary: series.title, start: { dateTime: occurrence.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: occurrence.schedule!.endAt!, timeZone: 'UTC' }, originalStartTime: { dateTime: occurrence.schedule!.startAt! } };
    let creates = 0; let patches = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return Response.json({ items: [{ id: account, primary: true, accessRole: 'owner', timeZone: 'UTC' }] });
      if (url.includes('/instances?')) return Response.json({ items: [instance] });
      if (init?.method === 'POST') { creates++; master = { ...JSON.parse(String(init.body)), etag: 'master-v1' }; return Response.json(master); }
      if (init?.method === 'PATCH') { patches++; instance = { ...instance, ...JSON.parse(String(init.body)), etag: 'v2' }; return Response.json(instance); }
      return Response.json(url.endsWith('/instance') ? instance : master);
    }));
    const runtime = app(workspace);
    const edited = copy(itemEditorSource(workspace, occurrence)); edited.title = 'Renamed once';
    await runtime.service.saveItem(edited, { recurrenceEdit: { occurrenceId: occurrence.id, scope: 'this_occurrence' }, google: { calendarId: account, busy: true, baseline: itemEditorSource(workspace, occurrence) } }, new Date(), background);
    await vi.waitFor(() => expect(runtime.workspace.items[occurrence.id]!.extensions?.['utm:googleSave']).toBeUndefined());
    runtime.reload();
    expect(runtime.workspace.items[occurrence.id]!.title).toBe('Renamed once');
    expect(instance.summary).toBe('Renamed once');
    expect(runtime.workspace.items[series.id]!.title).toBe(series.title);
    expect(runtime.workspace.items[series.id]!.extensions?.['utm:googleSave']).toBeUndefined();
    expect(creates).toBe(1); expect(patches).toBe(1);
  });

  it('repairs a legacy blocked create that already belongs to a linked Google master before saving its occurrence', async () => {
    const { workspace, item: series } = fixture(true);
    series.role = 'series_template';
    series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=3', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'PT0M', rdates: [], exdates: [] };
    const occurrence = createOccurrence(series, new Date(series.schedule!.startAt!), 0);
    workspace.items[occurrence.id] = occurrence;
    const unlinkedSeries = copy(series);
    delete unlinkedSeries.external;
    const stale = await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: account, item: unlinkedSeries, options: { calendarId: account, busy: true, baseline: unlinkedSeries } });
    series.extensions = { 'utm:googleSave': { ...stale, blocked: 'The event identifier is already in use. No event was changed.' } };
    let master: GoogleCalendarEvent = { id: series.external!.eventId, etag: 'master-v1', summary: series.title, recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'], start: { dateTime: series.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: series.schedule!.endAt!, timeZone: 'UTC' } };
    let instance: GoogleCalendarEvent = { id: 'instance', recurringEventId: master.id, originalStartTime: { dateTime: occurrence.occurrence!.recurrenceId }, etag: 'instance-v1', summary: series.title, start: { dateTime: occurrence.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: occurrence.schedule!.endAt!, timeZone: 'UTC' } };
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return Response.json({ items: [{ id: account, primary: true, accessRole: 'owner', timeZone: 'UTC' }] });
      if (url.includes('/instances?')) return Response.json({ items: [instance] });
      methods.push(init?.method ?? 'GET');
      if (init?.method === 'POST') return Response.json({}, { status: 409 });
      if (init?.method === 'PATCH' && url.includes('/instance')) { instance = { ...instance, ...JSON.parse(String(init.body)), etag: 'instance-v2' }; return Response.json(instance); }
      if (init?.method === 'PATCH') { master = { ...master, ...JSON.parse(String(init.body)), etag: 'master-v2' }; return Response.json(master); }
      return Response.json(url.endsWith('/instance') ? instance : master);
    }));
    const runtime = app(workspace);
    const edited = copy(itemEditorSource(workspace, occurrence)); edited.title = 'Recovered occurrence';
    await runtime.service.saveItem(edited, { recurrenceEdit: { occurrenceId: occurrence.id, scope: 'this_occurrence' }, google: { calendarId: account, busy: true, baseline: itemEditorSource(workspace, occurrence) } }, new Date());
    runtime.reload();
    expect(methods).not.toContain('POST');
    // The master draft is unchanged, so recovery only reads it back; the one
    // actual write is the selected instance PATCH.
    expect(methods.filter(method => method === 'PATCH')).toHaveLength(1);
    expect(instance.summary).toBe('Recovered occurrence');
    expect(runtime.workspace.items[series.id]!.extensions?.['utm:googleSave']).toBeUndefined();
    expect(runtime.workspace.items[occurrence.id]!.extensions?.['utm:googleSave']).toBeUndefined();
  });

  it('adopts a markerless legacy master collision before saving only one occurrence', async () => {
    const { workspace, item: series } = fixture();
    series.role = 'series_template';
    series.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=3', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, activationOffset: 'PT0M', rdates: [], exdates: [] };
    const occurrence = createOccurrence(series, new Date(series.schedule!.startAt!), 0);
    workspace.items[occurrence.id] = occurrence;
    const pending = await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: account, item: series, options: { calendarId: account, busy: true, baseline: series } });
    series.extensions = { 'utm:googleSave': { ...pending, blocked: 'The event identifier is already in use. No event was changed.' } };
    let master: GoogleCalendarEvent = {
      id: pending.eventId, etag: 'legacy-master-v1', summary: series.title,
      recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
      start: { dateTime: series.schedule!.startAt!, timeZone: 'UTC' },
      end: { dateTime: series.schedule!.endAt!, timeZone: 'UTC' },
    };
    let instance: GoogleCalendarEvent = {
      id: 'legacy-instance', recurringEventId: master.id,
      originalStartTime: { dateTime: occurrence.occurrence!.recurrenceId }, etag: 'instance-v1', summary: series.title,
      start: { dateTime: occurrence.schedule!.startAt!, timeZone: 'UTC' },
      end: { dateTime: occurrence.schedule!.endAt!, timeZone: 'UTC' },
    };
    let inserts = 0; let instancePatches = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return Response.json({ items: [{ id: account, primary: true, accessRole: 'owner', timeZone: 'UTC' }] });
      if (url.includes('/instances?')) return Response.json({ items: [instance] });
      if (init?.method === 'POST') { inserts++; return Response.json({}, { status: 409 }); }
      if (init?.method === 'PATCH' && url.includes('/legacy-instance')) {
        instancePatches++; instance = { ...instance, ...JSON.parse(String(init.body)), etag: 'instance-v2' }; return Response.json(instance);
      }
      if (init?.method === 'PATCH') { master = { ...master, ...JSON.parse(String(init.body)), etag: 'legacy-master-v2' }; return Response.json(master); }
      return Response.json(url.endsWith('/legacy-instance') ? instance : master);
    }));
    const runtime = app(workspace);
    const edited = copy(itemEditorSource(workspace, occurrence)); edited.title = 'One recovered occurrence';
    await runtime.service.saveItem(edited, { recurrenceEdit: { occurrenceId: occurrence.id, scope: 'this_occurrence' }, google: { calendarId: account, busy: true, baseline: itemEditorSource(workspace, occurrence) } }, new Date());
    runtime.reload();
    expect(inserts).toBe(1);
    expect(instancePatches).toBe(1);
    expect(instance.summary).toBe('One recovered occurrence');
    expect(runtime.workspace.items[series.id]!.external?.eventId).toBe(master.id);
    expect(runtime.workspace.items[series.id]!.extensions?.['utm:googleSave']).toBeUndefined();
    expect(runtime.workspace.items[occurrence.id]!.extensions?.['utm:googleSave']).toBeUndefined();
  });

  it('retains a newer calendar selection through an offline save and restart', async () => {
    const { workspace, item } = fixture();
    item.extensions = { 'utm:googleSave': await prepareGoogleSave({ workspaceId: workspace.workspaceId, accountEmail: account, item, options: { calendarId: account, busy: true, baseline: item } }) };
    const runtime = app(workspace);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Offline'); }));
    const edited = copy(item); edited.title = 'New title';
    const result = await runtime.service.saveItem(edited, { google: { calendarId: 'destination', busy: false, baseline: item } }, new Date());
    expect(result.pendingGoogle).toBe(true);
    runtime.reload();
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:googleSave']).toMatchObject({ desiredDestination: 'destination', desiredBusy: false });
    let event: GoogleCalendarEvent | undefined; let creates = 0; let moves = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return Response.json({ items: [{ id: account, primary: true, accessRole: 'owner', timeZone: 'UTC' }, { id: 'destination', accessRole: 'writer', timeZone: 'UTC' }] });
      if (url.includes('/move?')) { moves++; expect(init?.body).toBeUndefined(); return Response.json(event); }
      if (init?.method === 'POST') { creates++; event = { ...JSON.parse(String(init.body)), etag: 'v1' }; return Response.json(event); }
      if (init?.method === 'PATCH') { event = { ...event!, ...JSON.parse(String(init.body)), etag: 'v2' }; return Response.json(event); }
      return event ? Response.json(event) : Response.json({}, { status: 404 });
    }));
    await runtime.service.retryGoogleQueue(false, undefined, 'test'); runtime.reload();
    expect(runtime.workspace.items[item.id]!.external?.calendarId).toBe('destination');
    expect(runtime.workspace.items[item.id]!.title).toBe('New title');
    expect(event?.transparency).toBe('transparent');
    expect(runtime.workspace.items[item.id]!.extensions?.['utm:googleSave']).toBeUndefined();
    expect(creates).toBe(1); expect(moves).toBe(1);
  });
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
