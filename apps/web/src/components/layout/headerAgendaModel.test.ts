import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, createOccurrence, makeSeries, softDeleteItemTree } from '@utm/core';
import { formatAgendaRemaining, selectHeaderAgenda } from './headerAgendaModel';
const now = Date.parse('2026-09-23T12:00:00Z');
const iso = (seconds: number) => new Date(now + seconds * 1000).toISOString();
function fixture() {
  const workspace = createWorkspace('Header');
  workspace.items = {};
  const add = (title: string, start: number, end?: number) => {
    const item = createItem(title);
    item.schedule = { timezone: 'UTC', startAt: iso(start), ...(end === undefined ? {} : { endAt: iso(end) }) };
    workspace.items[item.id] = item;
    return item;
  };
  return { workspace, add };
}
it('shows departure before an event, travel as current, and then the event', () => {
  const { workspace, add } = fixture();
  workspace.calendarPreferences.language = 'ru';
  const item = add('Даша', 7200, 10800);
  item.schedule!.travelDuration = 'PT60M';
  expect(selectHeaderAgenda(workspace, now).next).toMatchObject({ at: now + 3600000, title: '[[travel-to]] Даша' });
  expect(selectHeaderAgenda(workspace, now + 3600000).current?.title).toBe('[[travel-road]] Даша');
  expect(selectHeaderAgenda(workspace, now + 3600000).next?.at).toBe(now + 7200000);
  expect(selectHeaderAgenda(workspace, now + 7200000).current?.title).toBe('Даша');
});
it('counts down to return travel, then skips its active interval; ignores pinned sleep', () => {
  const { workspace, add } = fixture();
  const sleep = add('Sleep', 1800, 3600);
  workspace.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, sleepItemId: sleep.id };
  const item = add('Meeting', 7200, 10800);
  item.schedule!.travelBackDuration = 'PT45M';
  add('Next', 14400, 18000);
  expect(selectHeaderAgenda(workspace, now).next?.title).toBe('Meeting');
  expect(selectHeaderAgenda(workspace, now + 7200000).next).toMatchObject({ at: now + 10800000, title: '[[travel-back-to]] Meeting' });
  expect(selectHeaderAgenda(workspace, now + 10800000).next?.title).toBe('Next');
});
describe('header agenda', () => {
  it.each([[1, '1 с'], [59000, '59 с'], [60000, '1 мин 0 с'], [3599000, '59 мин 59 с'], [3600000, '1 ч 0 мин'], [86399000, '23 ч 59 мин'], [86400000, '1 д 0 ч'], [183600000, '2 д 3 ч']])('formats %s ms', (ms, label) => expect(formatAgendaRemaining(ms, 'ru')).toBe(label));
  it('formats English units and rounds positive fractions upwards', () => {
    expect(formatAgendaRemaining(61001, 'en')).toBe('1 min 2 s');
  });
  it('selects current blocks, overlapping events and transitions through program gaps', () => {
    const { workspace, add } = fixture();
    add('Older', -100, 100);
    const item = add('Meeting', -60, 200);
    item.eventProgram = { blocks: [{ id: 'a', title: 'Talk', startOffsetSeconds: 30, endOffsetSeconds: 70 }, { id: 'b', title: 'Questions', startOffsetSeconds: 60, endOffsetSeconds: 80 }, { id: 'c', title: 'Next', startOffsetSeconds: 120, endOffsetSeconds: 150 }] };
    expect(selectHeaderAgenda(workspace, now)).toMatchObject({ current: { title: 'Questions' }, additional: 2, next: { title: 'Next' }, validUntil: now + 10000 });
    expect(selectHeaderAgenda(workspace, now + 80000).current?.title).toBe('Next');
    expect(selectHeaderAgenda(workspace, now + 100000).current?.title).toBe('Meeting');
    expect(selectHeaderAgenda(workspace, now + 200000).current).toBeUndefined();
  });
  it('prioritizes due, then program, then event at equal times', () => {
    const { workspace, add } = fixture();
    const current = add('Current', -60, 300);
    current.eventProgram = { blocks: [{ id: 'p', title: 'Program', startOffsetSeconds: 120, endOffsetSeconds: 150 }] };
    const next = add('Event', 60, 120);
    next.schedule!.dueAt = iso(60);
    expect(selectHeaderAgenda(workspace, now).next?.kind).toBe('due');
    delete next.schedule!.dueAt;
    expect(selectHeaderAgenda(workspace, now).next?.kind).toBe('program');
    expect(selectHeaderAgenda(workspace, now + 60000).next).toBeUndefined();
  });
  it('ignores closed/deleted items, overdue deadlines and untimed current events', () => {
    const { workspace, add } = fixture();
    add('Done', 1).state = 'done';
    add('Cancelled', 1).state = 'cancelled';
    add('Deleted', 1).deletedAt = iso(-1);
    add('No end', -10).schedule!.dueAt = iso(-1);
    add('Date only', -10, 100).schedule!.plannedDate = '2026-09-23';
    expect(selectHeaderAgenda(workspace, now)).toEqual({ concurrent: [], additional: 0, validUntil: Infinity });
  });
  it('removes an upcoming item immediately after soft deletion', () => {
    const { workspace, add } = fixture();
    const food = add('Приготовить поесть', 3600, 7200);
    expect(selectHeaderAgenda(workspace, now).next?.id).toBe(food.id);
    softDeleteItemTree(workspace, food.id, iso(1));
    expect(selectHeaderAgenda(workspace, now).next).toBeUndefined();
  });
  it('defaults to timed Due, with explicit all and off preferences', () => {
    const { workspace, add } = fixture();
    const dateOnly = add('Day deadline', 1000); dateOnly.schedule!.dueAt = iso(200); dateOnly.schedule!.dueDateOnly = true;
    const timed = add('Timed deadline', 1000); timed.schedule!.dueAt = iso(300);
    expect(selectHeaderAgenda(workspace, now).next?.title).toBe('Timed deadline');
    workspace.calendarPreferences.appearance.headerDueMode = 'all';
    expect(selectHeaderAgenda(workspace, now).next?.title).toBe('Day deadline');
    workspace.calendarPreferences.appearance.headerDueMode = 'off';
    expect(selectHeaderAgenda(workspace, now).next?.kind).toBe('event');
  });
  it('shows the longer overlapping event first and promotes the other when it ends', () => {
    const { workspace, add } = fixture();
    add('Long', -120, 300); add('Short', -30, 100);
    expect(selectHeaderAgenda(workspace, now)).toMatchObject({ current: { title: 'Long' }, concurrent: [{ title: 'Short' }] });
    expect(selectHeaderAgenda(workspace, now + 150000)).toMatchObject({ current: { title: 'Long' }, concurrent: [] });
  });
  it('finds remote recurring cycles, skips closed exceptions and never persists projections', () => {
    const { workspace, add } = fixture();
    const series = makeSeries(add('Yearly', 86400, 90000), 'FREQ=YEARLY');
    workspace.items[series.id] = series;
    const occurrence = createOccurrence(series, new Date(iso(86400)), 0);
    occurrence.state = 'done'; workspace.items[occurrence.id] = occurrence;
    const before = JSON.stringify(workspace);
    expect(selectHeaderAgenda(workspace, now).next?.at).toBe(Date.parse('2027-09-24T12:00:00Z'));
    expect(JSON.stringify(workspace)).toBe(before);
  });
  it('honors recurrence exclusions and tombstones without stored exception items', () => {
    const { workspace, add } = fixture();
    const series = makeSeries(add('Daily', 60, 120), 'FREQ=DAILY');
    series.recurrence!.exdates = [iso(60)];
    workspace.items[series.id] = series;
    const deleted = createOccurrence(series, new Date(iso(86460)), 0);
    workspace.tombstones[deleted.id] = iso(-1);
    expect(selectHeaderAgenda(workspace, now).next?.at).toBe(now + 172860000);
  });
  it('uses moved exceptions and catches recurring events longer than one day', () => {
    const { workspace, add } = fixture();
    const series = makeSeries(add('Long', -172800, 86400), 'FREQ=WEEKLY');
    workspace.items[series.id] = series;
    expect(selectHeaderAgenda(workspace, now).current?.title).toBe('Long');
    const occurrence = createOccurrence(series, new Date(iso(-172800)), 0);
    occurrence.schedule!.startAt = iso(10); occurrence.schedule!.endAt = iso(100);
    workspace.items[occurrence.id] = occurrence;
    expect(selectHeaderAgenda(workspace, now).current).toBeUndefined();
    expect(selectHeaderAgenda(workspace, now).next?.at).toBe(now + 10000);
  });
});
