import { afterEach, describe, expect, it, vi } from 'vitest';
import { createItem } from '@utm/core';
import { GOOGLE_SAVE_EXTENSION, itemGoogleDraft, needsGoogleSave, prepareGoogleSave, saveGoogleItem, type GoogleSaveOperation } from './googleItemSave';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const fixture = () => {
  const item = createItem('Meeting'); item.schedule = { timezone: 'UTC', startAt: '2030-09-20T12:00:00Z', endAt: '2030-09-20T13:00:00Z', estimatedDuration: 'PT20M' };
  return item;
};
const calendars = { items: [{ id: 'source', primary: true, accessRole: 'owner', timeZone: 'UTC' }, { id: 'destination', accessRole: 'writer', timeZone: 'UTC' }] };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('unified Google item save', () => {
  it('resolves a single recurrence by original start and patches its instance id', async () => {
    const baseline = fixture(); const item = structuredClone(baseline); item.title = 'Only this';
    item.extensions = { 'utm:googleInstance': { calendarId: 'source', masterId: 'master', originalStart: item.schedule!.startAt! } };
    const options = { calendarId: 'source', busy: true, baseline };
    item.extensions[GOOGLE_SAVE_EXTENSION] = await prepareGoogleSave({ workspaceId: 'w', accountEmail: 'source', item, options });
    const remote = { id: 'master_20300920T120000Z', etag: 'v1', summary: 'Meeting', description: '', location: '', start: { dateTime: item.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: item.schedule!.endAt!, timeZone: 'UTC' }, originalStartTime: { dateTime: item.schedule!.startAt! }, recurringEventId: 'master' };
    const patches: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return reply(calendars);
      if (url.includes('/instances?')) return reply({ items: [remote] });
      if (init?.method === 'PATCH') { patches.push(url); return reply({ ...remote, ...JSON.parse(String(init.body)), etag: 'v2' }); }
      return reply(remote);
    }));
    const apply = vi.fn(async () => {});
    await saveGoogleItem({ token: 'test', workspaceId: 'w', accountEmail: 'source', item, options, persist: async () => {}, apply });
    expect(patches).toHaveLength(1); expect(patches[0]).toContain('/events/master_20300920T120000Z');
    expect(apply).toHaveBeenCalledWith('source', expect.objectContaining({ summary: 'Only this' }), true);
  });
  it('exports a weekly master RRULE and exceptions instead of only its first instance', async () => {
    const item = fixture(); item.role = 'series_template';
    item.recurrence = { rrule: 'FREQ=WEEKLY;COUNT=4', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, rdates: [], exdates: ['2030-09-27T12:00:00Z'] };
    const options = { calendarId: 'source', busy: true, baseline: fixture() };
    const op = await prepareGoogleSave({ workspaceId: 'w', accountEmail: 'source', item, options });
    expect(op.draft.recurrence).toEqual(['RRULE:FREQ=WEEKLY;COUNT=4', 'EXDATE:20300927T120000Z']);
    item.extensions = { [GOOGLE_SAVE_EXTENSION]: structuredClone(op) };
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return reply(calendars);
      const body = JSON.parse(String(init?.body)); bodies.push(body); return reply({ ...body, etag: 'v1' });
    }));
    await saveGoogleItem({ token: 'test', workspaceId: 'w', accountEmail: 'source', item, options, persist: async () => {}, apply: async () => {} });
    expect(bodies).toHaveLength(1); expect(bodies[0]!.recurrence).toEqual(op.draft.recurrence);
  });
  it('recovers a lost series trim response before creating future repeats', async () => {
    const item = fixture(); item.role = 'series_template';
    item.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, rdates: [], exdates: [] };
    let remote = { id: 'master', etag: 'old', recurrence: ['RRULE:FREQ=WEEKLY'], summary: 'Meeting', start: { dateTime: item.schedule!.startAt! }, end: { dateTime: item.schedule!.endAt! } };
    item.extensions = { 'utm:googleSplit': { seriesId: 'old-series', calendarId: 'source', eventId: 'master', baseline: remote, recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20300919T235959Z'] } };
    const options = { calendarId: 'source', busy: true, baseline: item };
    item.extensions[GOOGLE_SAVE_EXTENSION] = await prepareGoogleSave({ workspaceId: 'w', accountEmail: 'source', item, options });
    let trims = 0; let creates = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return reply(calendars);
      if (init?.method === 'PATCH') { trims++; remote = { ...remote, ...JSON.parse(String(init.body)), etag: 'trimmed' }; throw new TypeError('Lost response'); }
      if (init?.method === 'POST') { creates++; return reply({ ...JSON.parse(String(init.body)), etag: 'new' }); }
      return reply(remote);
    }));
    const args = { token: 'test', workspaceId: 'w', accountEmail: 'source', item, options, persist: async (op: GoogleSaveOperation) => { item.extensions![GOOGLE_SAVE_EXTENSION] = structuredClone(op); }, apply: vi.fn(async () => {}) };
    await expect(saveGoogleItem(args)).rejects.toThrow('Lost response');
    expect(creates).toBe(0);
    await saveGoogleItem(args);
    expect(trims).toBe(1); expect(creates).toBe(1); expect(args.apply).toHaveBeenCalledOnce();
  });
  it('deletes a linked event after the local end was cleared, and treats an already deleted event as success', async () => {
    const item = fixture(); delete item.schedule!.endAt;
    const operation: GoogleSaveOperation = { kind: 'delete', calendarId: 'source', destination: 'source', eventId: 'event', accountEmail: 'source', draft: { title: '', description: '', location: '', start: '', end: '', allDay: false, timeZone: 'UTC', busy: true } };
    item.extensions = { [GOOGLE_SAVE_EXTENSION]: operation };
    const fetch = vi.fn(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
    const persist = vi.fn(async () => {}); const apply = vi.fn(async () => {});
    const args = { token: 'test', workspaceId: 'workspace', accountEmail: 'source', item, options: { calendarId: 'source', busy: true, baseline: item }, persist, apply };
    await saveGoogleItem(args);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/events/event'), expect.objectContaining({ method: 'DELETE' }));
    expect(apply).toHaveBeenCalledWith('source', { id: 'event', status: 'cancelled' }, true);
  });
  it('prepares an idempotent durable operation without authorization or network', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const item = fixture(); const args = { workspaceId: 'workspace', accountEmail: 'source', item, options: { calendarId: 'source', busy: true, baseline: item } };
    const first = await prepareGoogleSave(args); const second = await prepareGoogleSave(args);
    expect(first.eventId).toBe(second.eventId); expect(first.draft.title).toBe('Meeting'); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not need Google for local-only changes and preserves the estimate', () => {
    const before = fixture(); before.external = { provider: 'google_calendar', connectionId: 'connection', eventId: 'event', calendarId: 'source', sourceUrl: '', readOnly: false, syncedAt: '', startAt: before.schedule!.startAt!, endAt: before.schedule!.endAt!, etag: 'v1' };
    const item = structuredClone(before); item.tags = ['Important']; item.schedule!.estimatedDuration = 'PT10M';
    expect(needsGoogleSave(item, { baseline: before, calendarId: 'source', busy: true })).toBe(false);
    expect(itemGoogleDraft(item, true).end).toBe('2030-09-20T13:00:00Z');
    item.title = 'Edited'; expect(needsGoogleSave(item, { baseline: before, calendarId: 'source', busy: true })).toBe(true);
  });
  it('creates once across an uncertain response and a resumed persisted operation', async () => {
    const item = fixture(); let remote: any; let inserts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return reply(calendars);
      if (init?.method === 'POST') { inserts++; if (remote) return reply({}, 409); remote = JSON.parse(String(init.body)); throw new TypeError('Network lost'); }
      return reply(remote);
    }));
    const persist = async (op: GoogleSaveOperation) => { item.extensions = { [GOOGLE_SAVE_EXTENSION]: structuredClone(op) }; };
    const apply = vi.fn(async () => {});
    const args = { token: 'test', workspaceId: 'workspace', accountEmail: 'source', item, options: { calendarId: 'source', busy: true, baseline: fixture() }, persist, apply };
    await expect(saveGoogleItem(args)).rejects.toThrow('Network lost');
    const stored = item.extensions![GOOGLE_SAVE_EXTENSION] as GoogleSaveOperation;
    stored.draft = Object.fromEntries(Object.entries(stored.draft).sort(([a], [b]) => a.localeCompare(b))) as unknown as GoogleSaveOperation['draft'];
    await saveGoogleItem(args);
    expect(inserts).toBe(2); expect(apply).toHaveBeenCalledOnce(); expect(item.schedule!.estimatedDuration).toBe('PT20M');
  });
  it('finishes a pending create and then sends a newer local edit to the same Google event', async () => {
    const item = fixture();
    const oldDraft = itemGoogleDraft(item, true);
    item.title = 'Updated meeting';
    item.extensions = { [GOOGLE_SAVE_EXTENSION]: { kind: 'create', calendarId: 'source', destination: 'source', eventId: 'utm123456', accountEmail: 'source', draft: oldDraft } };
    let creates = 0; let edits = 0;
    const remote = { id: 'utm123456', etag: 'v1', summary: 'Meeting', start: { dateTime: item.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: item.schedule!.endAt!, timeZone: 'UTC' } };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return reply(calendars);
      if (init?.method === 'POST') { creates++; return reply(remote); }
      if (init?.method === 'PATCH') { edits++; return reply({ ...remote, etag: 'v2', summary: 'Updated meeting' }); }
      return reply(remote);
    }));
    const persist = async (op: GoogleSaveOperation) => { item.extensions![GOOGLE_SAVE_EXTENSION] = structuredClone(op); };
    const apply = vi.fn(async (_calendarId: string, _event: unknown, _finished: boolean, next?: GoogleSaveOperation) => {
      if (next) item.extensions![GOOGLE_SAVE_EXTENSION] = structuredClone(next);
      else delete item.extensions![GOOGLE_SAVE_EXTENSION];
    });
    await saveGoogleItem({ token: 'test', workspaceId: 'workspace', accountEmail: 'source', item, options: { calendarId: 'source', busy: true, baseline: fixture() }, persist, apply });
    expect(creates).toBe(1); expect(edits).toBe(1);
    expect(apply).toHaveBeenNthCalledWith(1, 'source', expect.objectContaining({ id: 'utm123456' }), true, expect.objectContaining({ draft: expect.objectContaining({ title: 'Updated meeting' }) }));
    expect(item.extensions![GOOGLE_SAVE_EXTENSION]).toBeUndefined();
  });
  it('recovers a lost move response without patching or moving twice', async () => {
    const item = fixture(); item.external = { provider: 'google_calendar', connectionId: 'connection', eventId: 'event', calendarId: 'source', sourceUrl: '', readOnly: false, syncedAt: '', startAt: item.schedule!.startAt!, endAt: item.schedule!.endAt!, etag: 'v1' };
    let remote = { id: 'event', iCalUID: 'unique', summary: item.title, description: '', location: '', etag: 'v1', start: { dateTime: item.schedule!.startAt!, timeZone: 'UTC' }, end: { dateTime: item.schedule!.endAt!, timeZone: 'UTC' } };
    let moves = 0; let patches = 0;
    const baseline = structuredClone(item); item.title = 'Changed';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('calendarList')) return reply(calendars);
      if (init?.method === 'PATCH') { patches++; remote = { ...remote, ...JSON.parse(String(init.body)), etag: 'v2' }; return reply(remote); }
      if (url.includes('/move?')) { moves++; throw new TypeError('Lost move response'); }
      return reply(remote);
    }));
    const persist = async (op: GoogleSaveOperation) => { item.extensions = { [GOOGLE_SAVE_EXTENSION]: structuredClone(op) }; };
    const apply = vi.fn(async () => {});
    const args = { token: 'test', workspaceId: 'workspace', accountEmail: 'source', item, options: { calendarId: 'destination', busy: true, baseline }, persist, apply };
    await expect(saveGoogleItem(args)).rejects.toThrow('Lost move response');
    await saveGoogleItem(args);
    expect(patches).toBe(1); expect(moves).toBe(1); expect(apply).toHaveBeenLastCalledWith('destination', expect.objectContaining({ id: 'event' }), true);
  });
  it('converts all-day instants in the item timezone', () => {
    const item = fixture(); item.schedule = { timezone: 'Europe/Moscow', allDay: true, startAt: '2030-09-19T21:00:00Z', endAt: '2030-09-20T21:00:00Z', estimatedDuration: 'PT20M' };
    expect(itemGoogleDraft(item, true)).toMatchObject({ start: '2030-09-20', end: '2030-09-21', allDay: true });
  });
});
