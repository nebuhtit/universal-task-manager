import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyGoogleCalendarSync, createItem, createOccurrence, createWorkspace, migrateWorkspace, validateWorkspace, type UniversalItem } from '@utm/core';
import { dayBounds, itemInterval, hiddenIntervals, buildSegments, layoutEvents, positionAt } from './timelineLayout';
import { timelineData } from './timelineData';
import { CalendarTimeline, TimelineNow } from './CalendarTimeline';

const now = new Date('2026-09-22T12:00:00Z');
const at = (hour: number, minute = 0) => Date.UTC(2026, 8, 22, hour, minute);
const iso = (hour: number, minute = 0) => new Date(at(hour, minute)).toISOString();
function item(id: string, schedule: Partial<NonNullable<UniversalItem['schedule']>> = {}) {
  return { ...createItem(id, 'task', now), id, schedule: { timezone: 'UTC', ...schedule } };
}
function workspace(...items: UniversalItem[]) {
  const w = createWorkspace('Timeline test', now); w.calendarPreferences.timezone = 'UTC';
  w.calendarPreferences.dayView.filter.source = 'true';
  w.items = Object.fromEntries(items.map(i => [i.id, i])); return w;
}
const day = dayBounds('2026-09-22', 'UTC');

describe('timeline time geometry', () => {
  it('uses explicit boundaries, start+duration and end/due-duration without modifying items', () => {
    const i = item('due', { dueAt: iso(18), estimatedDuration: 'PT2H' });
    const before = JSON.stringify(i);
    expect(itemInterval(i)).toMatchObject({ start: at(16), end: at(18) });
    expect(itemInterval(item('start', { startAt: iso(10), estimatedDuration: 'PT1H' }))).toMatchObject({ start: at(10), end: at(11) });
    expect(itemInterval(item('end', { endAt: iso(10), estimatedDuration: 'PT1H' }))).toMatchObject({ start: at(9), end: at(10) });
    expect(itemInterval(item('explicit', { startAt: iso(10), endAt: iso(11), estimatedDuration: 'PT5H' }))).toMatchObject({ start: at(10), end: at(11) });
    expect(JSON.stringify(i)).toBe(before);
  });
  it('keeps points and invalid intervals visible', () => {
    expect(itemInterval(item('point', { dueAt: iso(9) }))).toMatchObject({ start: at(9), end: at(9), point: true });
    expect(itemInterval(item('invalid', { startAt: iso(10), endAt: iso(9) }))).toMatchObject({ invalid: true, point: true });
  });
  it('uses actual 23/25-hour zoned days at DST transitions', () => {
    const spring = dayBounds('2026-03-29', 'Europe/Berlin'), autumn = dayBounds('2026-10-25', 'Europe/Berlin');
    expect(spring.end - spring.start).toBe(23 * 3600000); expect(autumn.end - autumn.start).toBe(25 * 3600000);
  });
  it('cuts occupied intervals out of sleep and maps break boundaries exactly', () => {
    const hidden = hiddenIntervals([{ start: at(-1), end: at(7) }], [{ start: at(3), end: at(4) }], day);
    expect(hidden).toEqual([{ start: day.start, end: at(3) }, { start: at(4), end: at(7) }]);
    const segments = buildSegments(day, hidden);
    expect(positionAt(at(3), segments)).toBe(36); expect(positionAt(at(4), segments)).toBe(96);
  });
  it('gives minute events a readable title without changing their interval', () => {
    const event = itemInterval(item('minute', { startAt: iso(10), endAt: iso(10, 1) }))!;
    const placed = layoutEvents([event], day, buildSegments(day, []), 2).events[0]!;
    expect(placed.height).toBe(36); expect(placed.end - placed.start).toBe(60000);
  });
  it('resolves both temporal and visual collisions with bounded columns and More', () => {
    const events = Array.from({ length: 5 }, (_, index) => itemInterval(item(String(index), { startAt: iso(10), endAt: iso(11) }))!);
    for (const limit of [2, 4]) {
      const result = layoutEvents(events, day, buildSegments(day, []), limit);
      expect(result.events).toHaveLength(limit - 1); expect(result.more[0]!.items).toHaveLength(6 - limit);
      expect(result.events.every(v => v.columns === limit)).toBe(true);
    }
    const adjacent = [10, 11].map(hour => itemInterval(item(String(hour), { startAt: iso(hour), endAt: iso(hour + 1) }))!);
    expect(layoutEvents(adjacent, day, buildSegments(day, []), 2).events.every(v => v.columns === 1)).toBe(true);
    const short = [0, 1].map(minute => itemInterval(item(String(minute), { startAt: iso(10, minute), endAt: iso(10, minute + 1) }))!);
    expect(layoutEvents(short, day, buildSegments(day, []), 2).events.every(v => v.columns === 2)).toBe(true);
  });
  it('clips midnight-spanning items and excludes next-day points', () => {
    const events = [itemInterval(item('span', { startAt: iso(-1), endAt: iso(25) }))!, itemInterval(item('next', { dueAt: iso(24) }))!];
    const result = layoutEvents(events, day, buildSegments(day, []), 2);
    expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ continuedBefore: true, continuedAfter: true });
  });
});

describe('timeline data and UI', () => {
  it('keeps one linked Google identity and leaves local history untouched', () => {
    const linked = item('linked', { dueAt: iso(18), estimatedDuration: 'PT20M' });
    linked.extensions = { 'utm:googleCreate': { eventId: 'remote', calendarId: 'calendar', accountEmail: 'test' } };
    linked.completionEntries = [{ id: 'done', at: iso(9), kind: 'manual' }];
    const w = workspace(linked);
    applyGoogleCalendarSync(w, { calendarId: 'calendar', connectionId: 'connection', syncedAt: iso(10), fullSync: false, events: [{ id: 'remote', summary: 'Linked', start: { dateTime: iso(12) }, end: { dateTime: iso(13) }, etag: 'v1' }] });
    const before = JSON.stringify(w), data = timelineData(w, '2026-09-22', now);
    expect(data.events).toHaveLength(1);
    expect(data.events[0]).toMatchObject({ start: at(12), end: at(13), item: { id: 'linked' } });
    expect(JSON.stringify(w)).toBe(before);
  });
  it('does not duplicate a moved materialized occurrence or an excluded date', () => {
    const series = item('series', { startAt: iso(10), endAt: iso(11) }); series.role = 'series_template';
    series.recurrence = { rrule: 'FREQ=DAILY', rdates: [], exdates: [iso(34)], timezone: 'UTC', autoRenew: false, anchor: 'schedule', closeAt: 'never' };
    const occurrence = createOccurrence(series, new Date(iso(10)), 0);
    occurrence.schedule = { timezone: 'UTC', startAt: iso(14), endAt: iso(15) };
    const w = workspace(series, occurrence), before = JSON.stringify(w);
    expect(timelineData(w, '2026-09-22', now).events.map(event => event.item.id)).toEqual([occurrence.id]);
    expect(timelineData(w, '2026-09-23', now).events).toHaveLength(0);
    expect(JSON.stringify(w)).toBe(before);
  });
  it('separates all-day/undated and uses computed due intervals across midnight', () => {
    const w = workspace(item('all', { allDay: true, startAt: iso(0), endAt: iso(24) }), item('none'), item('due', { dueAt: iso(25), estimatedDuration: 'PT2H' }));
    const before = JSON.stringify(w), data = timelineData(w, '2026-09-22', now);
    expect(data.allDay.map(i => i.id)).toEqual(['all']); expect(data.undated.map(i => i.id)).toEqual(['none']);
    expect(data.events.map(i => i.item.id)).toEqual(['due']); expect(JSON.stringify(w)).toBe(before);
  });
  it('shows an undated series once instead of generating undated repeats', () => {
    const series = item('undated series'); series.role = 'series_template';
    series.recurrence = { rrule: 'FREQ=DAILY', rdates: [], exdates: [], timezone: 'UTC', autoRenew: false, anchor: 'schedule', closeAt: 'never' };
    expect(timelineData(workspace(series), '2026-09-22', now).undated.map(value => value.id)).toEqual([series.id]);
  });
  it('respects the filter and does not hide other events during sleep', () => {
    const w = workspace(item('sleep', { startAt: iso(0), endAt: iso(7) }), item('meeting', { startAt: iso(3), endAt: iso(4) }), item('none'));
    w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: true, sleepItemId: 'sleep' };
    const data = timelineData(w, '2026-09-22', now);
    expect(data.events.map(i => i.item.id)).toEqual(['meeting']); expect(data.hidden).toHaveLength(2);
    w.calendarPreferences.dayView.filter.source = 'false';
    expect(timelineData(w, '2026-09-22', now).undated).toEqual([]);
  });
  it('projects recurring sleep without materializing it', () => {
    const sleep = item('sleep', { startAt: iso(-1), endAt: iso(7) }); sleep.role = 'series_template';
    sleep.recurrence = { rrule: 'FREQ=DAILY', rdates: [], exdates: [], timezone: 'UTC', autoRenew: false, anchor: 'schedule', closeAt: 'never' };
    const w = workspace(sleep); w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: true, sleepItemId: 'sleep' };
    const before = JSON.stringify(w), data = timelineData(w, '2026-09-22', now);
    expect(data.hidden.length).toBeGreaterThan(0); expect(JSON.stringify(w)).toBe(before);
  });
  it('retains optional settings through validation and normalization', () => {
    const w = workspace(); w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: true, sleepItemId: 'sleep' };
    expect(validateWorkspace(w).valid).toBe(true);
    expect(migrateWorkspace(w).value.calendarPreferences.timeline).toEqual(w.calendarPreferences.timeline);
  });
  it('renders titles for minute events and a current-time line only on its day', () => {
    const w = workspace(item('Minute title', { startAt: iso(10), endAt: iso(10, 1) }));
    const markup = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => undefined} onPreferences={() => undefined} />);
    expect(markup).toContain('Minute title'); expect(markup).toContain('data-testid="timeline-now"');
    expect(renderToStaticMarkup(<TimelineNow workspace={w} segments={buildSegments(day, [])} suppliedNow={new Date(iso(24))} />)).toBe('');
  });
  it('places now on a hidden break and changes its position at the minute boundary', () => {
    const w = workspace(), segments = buildSegments(day, [{ start: at(0), end: at(7) }]);
    const hidden = renderToStaticMarkup(<TimelineNow workspace={w} segments={segments} suppliedNow={new Date(iso(3))} />);
    expect(hidden).toContain('is-hidden-time'); expect(hidden).toContain('top:18px');
    const minute = renderToStaticMarkup(<TimelineNow workspace={w} segments={buildSegments(day, [])} suppliedNow={new Date(iso(12, 1))} />);
    expect(minute).toContain('top:721px'); expect(minute).toContain('12:01');
  });
});
