import { afterEach, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { agendaInput, agendaWidgetWorkspace, calculateAgendaInWorker } from './agendaWorker';
import { agendaWidgetSnapshot } from './nativeAgendaWidget';
afterEach(() => vi.unstubAllGlobals());
it('keeps projection identical and ignores unrelated changes', () => {
  const now = Date.parse('2026-09-28T08:00:00Z');
  const w = createWorkspace('Test'); const item = createItem('Event');
  item.schedule = { timezone: 'UTC', startAt: '2026-09-28T12:00:00Z', endAt: '2026-09-28T13:00:00Z', travelDuration: 'PT20M' };
  item.role = 'series_template'; item.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, activationOffset: 'PT0M', closeAt: 'due', rdates: [], exdates: [] };
  w.items[item.id] = item;
  const input = agendaInput(w, now);
  expect(agendaWidgetSnapshot(input.workspace, now)).toEqual(agendaWidgetSnapshot(w, now));
  w.updatedAt = new Date().toISOString(); item.bodyMarkdown = 'Private'; item.tags = ['tag']; item.revision++;
  item.schedule.estimatedDuration = 'PT90M'; item.schedule.actualDuration = 'PT5M';
  expect(agendaInput(w, now).key).toBe(input.key);
  expect(input.key).not.toContain('Private');
  item.schedule.startAt = '2026-09-28T14:00:00Z';
  expect(agendaInput(w, now).key).not.toBe(input.key);
});
it('invalidates on completion, deletion, language, time zone and sleep selection', () => {
  const now = Date.parse('2026-09-28T08:00:00Z');
  const w = createWorkspace('Test'); const item = createItem('Event');
  item.schedule = { timezone: 'UTC', startAt: '2026-09-28T10:00:00Z', endAt: '2026-09-28T11:00:00Z' }; w.items[item.id] = item;
  const original = agendaInput(w, now).key;
  item.state = 'done'; expect(agendaInput(w, now).key).not.toBe(original); item.state = 'open';
  w.tombstones[item.id] = '2026-09-28T08:00:00Z'; expect(agendaInput(w, now).key).not.toBe(original); delete w.tombstones[item.id];
  w.calendarPreferences.language = w.calendarPreferences.language === 'en' ? 'ru' : 'en'; expect(agendaInput(w, now).key).not.toBe(original);
  const beforeZone = agendaInput(w, now).key;
  w.calendarPreferences.timezone = 'Pacific/Auckland'; expect(agendaInput(w, now).key).not.toBe(beforeZone);
});
it('drops distant Google mirrors without changing the widget projection', () => {
  const now = Date.parse('2026-09-28T08:00:00Z');
  const w = createWorkspace('Large mirror');
  const near = createItem('Near'); near.schedule = { timezone: 'UTC', startAt: '2026-09-28T10:00:00Z', endAt: '2026-09-28T11:00:00Z' }; w.items[near.id] = near;
  for (let index = 0; index < 1_000; index += 1) {
    const item = createItem(`Distant ${index}`);
    item.role = 'occurrence';
    item.occurrence = { seriesId: 'series', recurrenceId: new Date(now + (index + 10) * 86_400_000).toISOString(), sequence: index, templateRevision: 1 };
    item.schedule = { timezone: 'UTC', startAt: new Date(now + (index + 10) * 86_400_000).toISOString(), endAt: new Date(now + (index + 10) * 86_400_000 + 3_600_000).toISOString() };
    w.items[item.id] = item;
  }
  const reduced = agendaWidgetWorkspace(w, now);
  expect(Object.keys(reduced.items).length).toBe(2);
  expect(agendaWidgetSnapshot(reduced, now)).toEqual(agendaWidgetSnapshot(w, now));
  expect(Object.keys(agendaInput(w, now).workspace.items).length).toBe(2);
});
it('terminates stale work and never resolves its late response', async () => {
  let fake: any;
  vi.stubGlobal('Worker', class { terminate = vi.fn(); postMessage = vi.fn(); constructor() { fake = this; } });
  const controller = new AbortController();
  const promise = calculateAgendaInWorker(createWorkspace('Test'), 0, controller.signal);
  controller.abort();
  await expect(promise).rejects.toThrow('cancelled');
  expect(fake.terminate).toHaveBeenCalledTimes(1);
  fake.onmessage({ data: { ok: true, snapshot: {}, durationMs: 1 } });
  expect(fake.terminate).toHaveBeenCalledTimes(1);
});
it('rejects unavailable workers without synchronous fallback', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('unavailable'); } });
  await expect(calculateAgendaInWorker(createWorkspace('Test'), 0, new AbortController().signal)).rejects.toThrow('unavailable');
});
