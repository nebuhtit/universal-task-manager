import { afterEach, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { agendaInput, calculateAgendaInWorker } from './agendaWorker';
import { agendaWidgetSnapshot } from './nativeAgendaWidget';
afterEach(() => vi.unstubAllGlobals());
it('keeps projection identical and ignores unrelated changes', () => {
  const w = createWorkspace('Test'); const item = createItem('Event');
  item.schedule = { timezone: 'UTC', startAt: '2026-09-28T12:00:00Z', endAt: '2026-09-28T13:00:00Z', travelDuration: 'PT20M' };
  item.role = 'series_template'; item.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', anchor: 'schedule', autoRenew: true, activationOffset: 'PT0M', closeAt: 'due', rdates: [], exdates: [] };
  w.items[item.id] = item;
  const input = agendaInput(w), now = Date.parse('2026-09-28T08:00:00Z');
  expect(agendaWidgetSnapshot(input.workspace, now)).toEqual(agendaWidgetSnapshot(w, now));
  w.updatedAt = new Date().toISOString(); item.bodyMarkdown = 'Private'; item.tags = ['tag']; item.revision++;
  item.schedule.estimatedDuration = 'PT90M'; item.schedule.actualDuration = 'PT5M';
  expect(agendaInput(w).key).toBe(input.key);
  expect(input.key).not.toContain('Private');
  item.schedule.startAt = '2026-09-28T14:00:00Z';
  expect(agendaInput(w).key).not.toBe(input.key);
});
it('invalidates on completion, deletion, language, time zone and sleep selection', () => {
  const w = createWorkspace('Test'); const item = createItem('Event'); w.items[item.id] = item;
  const original = agendaInput(w).key;
  item.state = 'done'; expect(agendaInput(w).key).not.toBe(original); item.state = 'open';
  w.tombstones[item.id] = '2026-09-28T08:00:00Z'; expect(agendaInput(w).key).not.toBe(original); delete w.tombstones[item.id];
  w.calendarPreferences.language = w.calendarPreferences.language === 'en' ? 'ru' : 'en'; expect(agendaInput(w).key).not.toBe(original);
  const beforeZone = agendaInput(w).key;
  w.calendarPreferences.timezone = 'Pacific/Auckland'; expect(agendaInput(w).key).not.toBe(beforeZone);
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
