import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyGoogleCalendarSync, createItem, createOccurrence, createWorkspace, migrateWorkspace, validateWorkspace, type UniversalItem } from '@utm/core';
import { dayBounds, itemInterval, hiddenIntervals, buildSegments, layoutEvents, layoutWithinEvents, placeActiveRangeCues, positionAt } from './timelineLayout';
import { timelineData, prepareTimelineData } from './timelineData';
import { buildCalendarPlan } from './calendarPlanning';
import { CalendarTimeline, TimelineNow } from './CalendarTimeline';
import { displayViewValue, readItemField } from '../items/fieldDisplay';

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
  it('does not propose a rolled related task outside Work on its old deadline day', () => {
    const clock = new Date(iso(21));
    const work = item('work', { startAt: iso(9), endAt: iso(16) });
    work.role = 'series_template';
    work.recurrence = { rrule: 'FREQ=DAILY', timezone: 'UTC', anchor: 'schedule', closeAt: 'next_activation', autoRenew: true, exdates: [], rdates: [] };
    const task = item('child', { dueAt: iso(9), estimatedDuration: 'PT10M' });
    task.relations = [{ id: 'r', type: 'scheduled_within', targetId: work.id }];
    const w = workspace(work, task);
    const today = prepareTimelineData(w, '2026-09-22', clock);
    const todayPlan = buildCalendarPlan(w, '2026-09-22', today, clock);
    expect(today.overdue.some(value => value.id === task.id)).toBe(false);
    expect(todayPlan.events.some(value => value.item.id === task.id)).toBe(false);
    const next = prepareTimelineData(w, '2026-09-23', clock);
    expect(next.events.find(value => value.item.id === task.id)?.item.schedule?.startAt).toBe('2026-09-23T09:00:00.000Z');
    expect(task.schedule?.dueAt).toBe(iso(9));
  });

  it('nests a root-linked task inside a split Work without counting the parent as an overlap', () => {
    const work = item('work-split', { startAt: iso(9), endAt: iso(16) });
    work.recurrenceOverride = { kind: 'future_split', sourceSeriesId: 'work-root', recurrenceId: iso(9) };
    const root = item('work-root');
    const task = item('child', { startAt: iso(9), endAt: iso(9, 10) });
    task.relations = [{ id: 'r', type: 'scheduled_within', targetId: root.id }];
    const w = workspace(root, work, task);
    const events = [work, task].map(value => itemInterval(value)!);
    const result = layoutWithinEvents(w, events, day, buildSegments(day, []), 2);
    expect(result.more).toEqual([]);
    const parent = result.events.find(row => row.item.id === work.id)!;
    const child = result.events.find(row => row.item.id === task.id)!;
    expect(parent.withinContainer).toBe(true);
    expect(child.withinParent).toBe(work.id);
    expect(child.columns).toBe(1);
    expect(child.top).toBeGreaterThan(parent.top);
    expect(child.top + child.height).toBeLessThanOrEqual(parent.top + parent.height);
    expect(child.start).toBe(at(9));
    // A real, unrelated overlap still receives its own column.
    const external = item('unrelated', { startAt: iso(9), endAt: iso(10) });
    const overlap = layoutWithinEvents(w, [...events, itemInterval(external)!], day, buildSegments(day, []), 2);
    expect(overlap.events.find(row => row.item.id === work.id)?.columns).toBe(2);
    expect(overlap.events.find(row => row.item.id === task.id)?.columns).toBe(2);
    expect(overlap.more).toEqual([]);
  });

  it('does not nest unrelated same-name items or a task outside its related block', () => {
    const work = item('work', { startAt: iso(9), endAt: iso(16) });
    const other = item('other', { startAt: iso(9), endAt: iso(10) }); other.title = work.title;
    other.relations = [{ id: 'r', type: 'scheduled_within', targetId: 'missing' }];
    const outside = item('outside', { startAt: iso(16), endAt: iso(17) });
    outside.relations = [{ id: 'r2', type: 'scheduled_within', targetId: work.id }];
    const w = workspace(work, other, outside);
    const result = layoutWithinEvents(w, [work, other, outside].map(value => itemInterval(value)!), day, buildSegments(day, []), 2);
    expect(result.events.every(row => !row.withinParent)).toBe(true);
  });

  it('keeps overflowing related cards and their More control inside Work', () => {
    const work = item('work', { startAt: iso(9), endAt: iso(11) });
    const tasks = Array.from({ length: 8 }, (_, index) => {
      const task = item(`child-${index}`, { startAt: iso(9, index * 10), endAt: iso(9, index * 10 + 10) });
      task.relations = [{ id: `r-${index}`, type: 'scheduled_within', targetId: work.id }];
      return task;
    });
    const w = workspace(work, ...tasks);
    // The source tasks have no fixed time: these slots are display projections.
    for (const task of tasks) w.items[task.id] = { ...task, schedule: { timezone: 'UTC', estimatedDuration: 'PT10M' } };
    const result = layoutWithinEvents(w, [work, ...tasks].map(value => itemInterval(value)!), day, buildSegments(day, []), 2);
    const parent = result.events.find(row => row.item.id === work.id)!;
    expect(result.more).toHaveLength(1);
    const more = result.more[0]!;
    expect(more.withinParent).toBe(work.id);
    const children = result.events.filter(row => row.withinParent);
    expect(children.every(row => row.columns === 1 && row.top + row.height <= more.top)).toBe(true);
    expect(more.top + more.height).toBe(parent.top + parent.height);
    expect([...children.map(row => row.item.id), ...more.items.map(value => value.id)].sort()).toEqual(tasks.map(value => value.id).sort());
  });

  it('labels hour marks with hours only while preserving minute precision for current time', () => {
    const clock = new Date(iso(12, 34));
    const html = renderToStaticMarkup(<CalendarTimeline workspace={workspace()} dateKey="2026-09-22" now={clock} suppliedNow={clock} onEdit={() => {}} onPreferences={() => {}} />);
    const tickLabels = [...html.matchAll(/class="timeline-tick"[^>]*><span>([^<]+)<\/span>/g)].map(match => match[1]);
    expect(tickLabels).toContain('12');
    expect(tickLabels.every(label => !label?.includes(':'))).toBe(true);
    expect(html).toContain('aria-label="Current time 12:34"');
    expect(html).toContain('data-testid="timeline-now"');
    expect(html).toContain('>12:34</span>');
  });
  it('dims completed travel and return borders together with past events without Due', () => {
    const event = item('Past trip', { startAt: iso(8), endAt: iso(9), travelDuration: 'PT30M', travelBackDuration: 'PT30M' });
    const html = renderToStaticMarkup(<CalendarTimeline workspace={workspace(event)} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => {}} onPreferences={() => {}} />);
    expect(html.match(/timeline-past-event timeline-travel/g)).toHaveLength(2);
    event.schedule!.dueAt = iso(10);
    const withDue = renderToStaticMarkup(<CalendarTimeline workspace={workspace(event)} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => {}} onPreferences={() => {}} />);
    expect(withDue).not.toContain('timeline-past-event');
  });
  it.each(['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'])('retains the reported weekly Event ends + Due active range on %s', key => {
    const series = item('00386ef6-d7f4-4c9c-80a5-d2bc66edaa8f', {
      startAt: '2026-09-03T18:15:00.000Z', endAt: '2026-09-03T19:00:00.000Z',
      dueAt: '2026-09-06T08:00:00.000Z', estimatedDuration: 'PT45M', timezone: 'Europe/Moscow',
    });
    series.title = 'Подготовка к вс'; series.role = 'series_template'; series.preset = 'event'; series.canBeCompleted = true;
    series.recurrence = { rrule: 'FREQ=WEEKLY;INTERVAL=1', timezone: 'Europe/Moscow', rdates: [], exdates: [], activationOffset: 'PT0M', closeAt: 'due', anchor: 'schedule', autoRenew: true };
    const w = workspace(series); w.calendarPreferences.timezone = 'Europe/Moscow';
    const clock = new Date('2026-09-26T20:58:00Z');
    const before = JSON.stringify(w);
    const prepared = prepareTimelineData(w, key, clock);
    expect(prepared.displayRanges).toHaveLength(1);
    expect(prepared.activeRange).toHaveLength(0);
    expect(prepared.displayRanges[0]?.schedule?.dueAt).toBe('2026-09-27T08:00:00.000Z');
    const plan = buildCalendarPlan(w, key, prepared, clock);
    const html = renderToStaticMarkup(<CalendarTimeline plan={plan} workspace={w} dateKey={key} now={clock} suppliedNow={clock} onEdit={() => {}} onPreferences={() => {}} />);
    expect(html).toContain('Подготовка к вс');
    expect(html).toContain(key === '2026-09-24' ? 'data-testid="timeline-event"' : 'data-testid="timeline-active-range"');
    if (key === '2026-09-26') {
      const reserve = item('Full day reserve', { startAt: '2026-09-25T21:00:00Z', endAt: '2026-09-26T21:00:00Z' });
      const fallback = renderToStaticMarkup(<CalendarTimeline plan={plan} workspace={w} dateKey={key} now={clock} suppliedNow={clock} reservedItems={[reserve]} onEdit={() => {}} onPreferences={() => {}} />);
      expect(fallback).toContain('Day tasks');
      expect(fallback).toContain('Подготовка к вс');
      expect(fallback).not.toContain('data-testid="timeline-active-range"');
    }
    expect(JSON.stringify(w)).toBe(before);
  });
  it.each(['2026-09-22', '2026-09-23'])('reconciles list ranges on %s and falls back to Day tasks without a free row', key => {
    const range = item('Preparation from List', { startAt: iso(21, 15), dueAt: '2026-09-23T11:00:00Z', estimatedDuration: 'PT45M' });
    const reserve = item('Full day reserve', { startAt: iso(0), endAt: iso(48) });
    const w = workspace(range);
    // Deliberately make the two projections disagree: the list remains authoritative
    // for visibility, while this must not mutate filters or scheduled dates.
    w.calendarPreferences.dayView.filter.source = 'false';
    const html = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey={key} now={now} suppliedNow={now} listItems={[range]} reservedItems={[reserve]} onEdit={() => {}} onPreferences={() => {}} />);
    expect(html).toContain('Day tasks');
    expect(html).toContain('Preparation from List');
    expect(html).not.toContain('data-testid="timeline-active-range"');
  });
  it('shows an unplaced active range as a free-row cue even with the shared plan', () => {
    const range = item('Preparation', { startAt: iso(21, 15), dueAt: '2026-09-23T11:00:00Z', estimatedDuration: 'PT45M' });
    const w = workspace(range);
    const late = new Date(iso(23, 50));
    const plan = buildCalendarPlan(w, '2026-09-22', prepareTimelineData(w, '2026-09-22', late), late);
    expect(plan.unplaced.map(entry => entry.id)).toContain(range.id);
    const before = JSON.stringify(w);
    const html = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-22" now={late} suppliedNow={late} plan={plan} onEdit={() => {}} onPreferences={() => {}} />);
    expect(html).toContain('data-testid="timeline-active-range"');
    expect(html).toContain('Preparation');
    expect(JSON.stringify(w)).toBe(before);
  });
  it('places active-range outlines outside events, hidden reserves, and collapsed sleep', () => {
    const segments = buildSegments(day, [{ start: at(0), end: at(8) }]);
    const cues = placeActiveRangeCues(['a', 'b'], segments, [{ top: 36, height: 60 }, { top: 132, height: 60 }]);
    expect(cues).toEqual([{ item: 'a', top: 96, height: 36 }, { item: 'b', top: 192, height: 36 }]);
    expect(placeActiveRangeCues(['a'], buildSegments(day, []), [{ top: 0, height: 24 * 60 }])).toEqual([]);
  });
  it('shows selected reminder metadata inside a timed block without repeating its interval', () => {
    const reminderItem = item('Reminder metadata', { startAt: iso(14), endAt: iso(16) });
    reminderItem.reminders = [{ id: 'r', mode: 'absolute', at: iso(15), urgency: 'normal', repeatUntilAcknowledged: false }];
    const w = workspace(reminderItem);
    w.calendarPreferences.dayView.timelineFields = ['title', 'reminders'];
    const reminderText = displayViewValue(readItemField(reminderItem, 'reminders', w, now), 'reminders', w.calendarPreferences.language);
    expect(reminderText).toMatch(/\d{2}:\d{2}/);
    expect(reminderText).not.toContain('normal');
    const html = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => {}} onPreferences={() => {}} />);
    // Verify the reminder property itself, not a coincidentally matching hour
    // tick or a clock value that assumes the test machine is in Moscow.
    expect(html).toContain(`${reminderText}</small>`);
    expect(html).not.toContain('normal');
    expect(html).not.toContain('<small>14:00–16:00</small>');
  });
  it('renders a filtered reserved interval beneath normal events without making it interactive', () => {
    const reserved = item('Hidden Work', { startAt: iso(9), endAt: iso(11) });
    const visible = item('Meeting', { startAt: iso(10), endAt: iso(12) });
    const w = workspace(reserved, visible);
    w.calendarPreferences.dayView.filter.source = 'title != "Hidden Work"';
    const markup = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-22" now={now} suppliedNow={now} reservedItems={[reserved]} onEdit={() => {}} onPreferences={() => {}} />);
    expect(markup).toContain('data-testid="timeline-hidden-reserve"');
    expect(markup.indexOf('timeline-hidden-reserve"')).toBeLessThan(markup.indexOf('timeline-events'));
  });
  it('renders travel separately, protects it from hidden sleep and leaves the source unchanged', () => {
    const event = item('Meeting', { startAt: iso(10), endAt: iso(11), travelDuration: 'PT30M' });
    const sleep = item('Sleep', { startAt: iso(0), endAt: iso(10) });
    const w = workspace(event, sleep);
    w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: true, sleepItemId: sleep.id };
    const before = JSON.stringify(w);
    const data = timelineData(w, '2026-09-22', now);
    expect(data.events.find(value => value.travel)).toMatchObject({ start: at(9, 30), end: at(10) });
    expect(data.hidden).toEqual([{ start: at(0), end: at(9, 30) }]);
    const html = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => {}} onPreferences={() => {}} />);
    expect(html).toContain('timeline-past-event timeline-travel');
    expect(html).toContain('30 min');
    const travelMarkup = html.match(/<button[^>]*data-testid="timeline-travel"[^>]*>(.*?)<\/button>/s)?.[1] ?? '';
    expect(travelMarkup).toContain('<strong>30 min</strong>');
    expect(travelMarkup).not.toContain('Meeting');
    expect(travelMarkup).not.toMatch(/Travel|В пути|Обратно/);
    expect(html).toContain('data-testid="timeline-event"');
    expect(JSON.stringify(w)).toBe(before);
  });
  it('does not expose Timeline reordering handles or draggable targets', () => {
    const event = item('Movable event', { startAt: iso(10), endAt: iso(11) });
    const w = workspace(event);
    const plan = buildCalendarPlan(w, '2026-09-22', prepareTimelineData(w, '2026-09-22', now), now);
    const html = renderToStaticMarkup(<CalendarTimeline plan={plan} workspace={w} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => {}} onPreferences={() => {}} />);
    expect(html).not.toContain('calendar-order-handle');
    expect(html).not.toContain('data-calendar-handle-id');
    expect(html).not.toContain('data-calendar-order-id');
  });
  it('shows the previous-day portion of travel even when the event starts tomorrow', () => {
    const w = workspace(item('Tomorrow', { startAt: '2026-09-23T00:15:00Z', endAt: '2026-09-23T01:00:00Z', travelDuration: 'PT30M' }));
    const data = timelineData(w, '2026-09-22', now);
    expect(data.events).toHaveLength(1);
    expect(data.events[0]?.travel).toBe(true);
    const layout = layoutEvents(data.events, data.day, buildSegments(data.day, []), 2);
    expect(layout.events[0]?.continuedAfter).toBe(true);
  });
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
  it('stacks four flexible tasks at full width instead of hiding them behind More', () => {
    const events = Array.from({ length: 4 }, (_, index) => itemInterval(item(`flex-${index}`, { availableFrom: iso(9) }))!);
    const before = JSON.stringify(events);
    const result = layoutEvents(events, day, buildSegments(day, []), 2, new Set(events.map(event => event.item.id)));
    expect(result.more).toEqual([]);
    expect(result.events).toHaveLength(4);
    expect(result.events.every(event => event.columns === 1 && event.height === 36 && event.flexibleVisual)).toBe(true);
    expect(result.events.map(event => event.top)).toEqual([540, 576, 612, 648]);
    expect(JSON.stringify(events)).toBe(before);
  });
  it('keeps flexible cards clear of timed events and compressed sleep', () => {
    const fixed = itemInterval(item('fixed', { startAt: iso(9), endAt: iso(10) }))!;
    const flex = itemInterval(item('flex', { availableFrom: iso(9) }))!;
    const segments = buildSegments(day, [{ start: day.start, end: at(8) }]);
    const result = layoutEvents([fixed, flex], day, segments, 2, new Set(['flex']));
    expect(result.events.find(event => event.item.id === 'fixed')).toMatchObject({ top: 96, height: 60 });
    expect(result.events.find(event => event.item.id === 'flex')).toMatchObject({ top: 156, height: 36, columns: 1 });
    expect(result.more).toEqual([]);
  });
  it('keeps stacked cards inside their active range', () => {
    const tasks = Array.from({ length: 4 }, (_, index) => itemInterval(item(`range-${index}`, { startAt: iso(9), dueAt: iso(17), estimatedDuration: 'PT5M' }))!);
    const result = layoutEvents(tasks, day, buildSegments(day, []), 2, new Set(tasks.map(event => event.item.id)));
    expect(result.more).toEqual([]);
    expect(result.events).toHaveLength(4);
    expect(result.events.every(event => event.top >= 540 && event.top + event.height <= 1020 && event.columns === 1)).toBe(true);
  });
  it('clips midnight-spanning items and excludes next-day points', () => {
    const events = [itemInterval(item('span', { startAt: iso(-1), endAt: iso(25) }))!, itemInterval(item('next', { dueAt: iso(24) }))!];
    const result = layoutEvents(events, day, buildSegments(day, []), 2);
    expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ continuedBefore: true, continuedAfter: true });
  });
});

describe('timeline data and UI', () => {
  it('renders one nested legacy cycle without deleting history or merging equal titles', () => {
    const series = item('root', { startAt: iso(9), dueAt: iso(81), estimatedDuration: 'PT1H' });
    series.role = 'series_template'; series.canBeCompleted = true;
    series.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', rdates: [], exdates: [], activationOffset: 'PT0M', closeAt: 'due', anchor: 'schedule', autoRenew: true };
    const nested = createOccurrence(series, new Date(iso(9)), 0);
    nested.role = 'series_template'; nested.recurrence = structuredClone(series.recurrence);
    const child = createOccurrence(nested, new Date(iso(9)), 0);
    const w = workspace(series, nested, child), before = JSON.stringify(w);
    expect(timelineData(w, '2026-09-23', now).activeRange.map(value => value.id)).toEqual([child.id]);
    expect(JSON.stringify(w)).toBe(before);
    child.state = 'done';
    expect(timelineData(w, '2026-09-23', now).activeRange).toHaveLength(0);
    expect(timelineData(w, '2026-09-30', now).activeRange).toHaveLength(1);
    const independent = { ...structuredClone(series), id: 'independent' }; w.items[independent.id] = independent;
    child.state = 'open';
    expect(timelineData(w, '2026-09-23', now).activeRange).toHaveLength(2);
  });
  it('uses normal View item cards above the axis, including all-day properties', () => {
    const event = item('All day title', { allDay: true, startAt: iso(0), endAt: iso(24) });
    event.tags = ['Visible tag'];
    const w = workspace(event); w.calendarPreferences.dayView.fields = ['title', 'tags'];
    const html = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => {}} onState={() => {}} onPreferences={() => {}} />);
    expect(html).toContain('item-card state-open'); expect(html).toContain('item-main');
    expect(html).not.toContain('Visible tag'); expect(html).not.toContain('Complete All day title');
  });
  it('shows active-range outlines on each day and hides only the completed cycle', () => {
    const series = item('range', { startAt: iso(9), dueAt: iso(81), estimatedDuration: 'PT1H' });
    series.role = 'series_template'; series.canBeCompleted = true;
    series.recurrence = { rrule: 'FREQ=WEEKLY', timezone: 'UTC', rdates: [], exdates: [], activationOffset: 'PT0M', closeAt: 'due', anchor: 'schedule', autoRenew: true };
    const w = workspace(series);
    const before = JSON.stringify(w);
    expect(timelineData(w, '2026-09-23', now).activeRange).toHaveLength(1);
    expect(timelineData(w, '2026-09-23', now).events).toHaveLength(0);
    const markup = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-23" now={now} suppliedNow={now} onEdit={() => {}} onPreferences={() => {}} />);
    expect(markup).toContain('data-testid="timeline-active-range"');
    expect(markup).toContain('15 min / day');
    expect(JSON.stringify(w)).toBe(before);
    const occurrence = createOccurrence(series, new Date(iso(9)), 0); occurrence.state = 'done'; w.items[occurrence.id] = occurrence;
    expect(timelineData(w, '2026-09-23', now).activeRange).toHaveLength(0);
    expect(timelineData(w, '2026-09-30', now).activeRange).toHaveLength(1);
  });
  it('keeps an active-range cue on every day even when a planned date is set', () => {
    const flexible = item('flexible', { startAt: iso(9), dueAt: iso(81), plannedDate: '2026-09-24', estimatedDuration: 'PT1H' });
    const w = workspace(flexible);
    expect(timelineData(w, '2026-09-22', now).activeRange).toHaveLength(1);
    expect(timelineData(w, '2026-09-23', now).activeRange).toHaveLength(1);
    expect(timelineData(w, '2026-09-24', now).activeRange).toHaveLength(1);
    expect(timelineData(w, '2026-09-25', now).activeRange).toHaveLength(1);
    expect(timelineData(w, '2026-09-26', now).activeRange).toHaveLength(0);
  });
  it('shows event span instead of stale estimate and uses source calendar color and icon', () => {
    const event = item('span', { startAt: iso(13, 15), endAt: iso(19), estimatedDuration: 'PT168H' });
    event.external = { provider: 'google_calendar', calendarId: 'c', connectionId: 'connection', eventId: 'e', sourceUrl: 'https://calendar.google.com/', readOnly: true, syncedAt: iso(10) };
    const w = workspace(event); w.calendarPreferences.dayView.fields = ['title', 'schedule.estimatedDuration', 'external.provider'];
    w.calendarPreferences.googleCalendar = { connectionId: 'connection', calendars: [{ id: 'c', name: 'Work', color: '#12ab34', selected: true }], syncTokens: {} };
    const html = renderToStaticMarkup(<CalendarTimeline workspace={w} dateKey="2026-09-22" now={now} suppliedNow={now} onEdit={() => {}} onPreferences={() => {}} />);
    expect(html).not.toContain('168'); expect(html).toContain('5 h 45 min');
    expect(html).toContain('border-color:#12ab34'); expect(html).toContain('aria-label="Google Calendar"');
    expect(html).toContain('timeline-calendar-tinted'); expect(html).toContain('--timeline-calendar-color:#12ab34');
    expect(event.schedule?.estimatedDuration).toBe('PT168H');
  });
  it('keeps one linked Google identity and leaves local history untouched', () => {
    const linked = item('linked', { dueAt: iso(18), estimatedDuration: 'PT20M' });
    linked.extensions = { 'utm:googleCreate': { eventId: 'remote', calendarId: 'calendar', accountEmail: 'test' } };
    linked.completionEntries = [{ id: 'done', at: iso(9), kind: 'manual', comment: 'Preserve history' }];
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
    w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, showUndated: true };
    const before = JSON.stringify(w), data = timelineData(w, '2026-09-22', now);
    expect(data.allDay.map(i => i.id)).toEqual(['all']); expect(data.undated.map(i => i.id)).toEqual(['none']);
    expect(data.events.map(i => i.item.id)).toEqual(['due']); expect(JSON.stringify(w)).toBe(before);
  });
  it('anchors a planned-day item with a timed Due at the deadline, not the current time', () => {
    const due = item('due-planned', { plannedDate: '2026-09-22', dueAt: iso(19, 52), estimatedDuration: 'PT10M' });
    const w = workspace(due);
    const data = timelineData(w, '2026-09-22', now);
    expect(data.events).toMatchObject([{ item: { id: 'due-planned' }, start: at(19, 42), end: at(19, 52) }]);
    expect(data.undated).toHaveLength(0);
    expect(data.planning.proposals).toHaveLength(0);
  });
  it('shows an undated series once instead of generating undated repeats', () => {
    const series = item('undated series'); series.role = 'series_template';
    series.recurrence = { rrule: 'FREQ=DAILY', rdates: [], exdates: [], timezone: 'UTC', autoRenew: false, anchor: 'schedule', closeAt: 'never' };
    const w = workspace(series); w.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, showUndated: true };
    expect(timelineData(w, '2026-09-22', now).undated.map(value => value.id)).toEqual([series.id]);
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
