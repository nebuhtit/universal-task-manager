import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { freeTimeForRange, freeTimeScaleMarks, freeTimeShareText, freeTimeShareTitle } from './freeTimeSharing';

const now = new Date('2026-10-06T00:00:00Z');

function workspace() {
  const value = createWorkspace('Free time share', now);
  value.calendarPreferences.timezone = 'UTC';
  value.calendarPreferences.dayView.filter.source = 'false';
  return value;
}

describe('free time sharing', () => {
  it('preserves past bookings and separates reserved Work from overlapping events', () => {
    const value = workspace();
    const work = createItem('Work', 'event', now);
    work.schedule = { timezone: 'UTC', startAt: '2026-10-06T09:00:00Z', endAt: '2026-10-06T17:00:00Z' };
    const meeting = createItem('Private meeting', 'event', now);
    meeting.schedule = { timezone: 'UTC', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T11:00:00Z' };
    value.items[work.id] = work; value.items[meeting.id] = meeting;
    value.calendarPreferences.dayView.statistics = { showTime: true, reservedItemIds: [work.id] };
    const [day] = freeTimeForRange(value, '2026-10-06', '2026-10-06', 0, new Date('2026-10-06T15:00:00Z'));
    expect(day?.reserved).toEqual([{ start: Date.parse(work.schedule.startAt!), end: Date.parse(work.schedule.endAt!) }]);
    expect(day?.booked).toEqual([{ start: Date.parse(meeting.schedule.startAt!), end: Date.parse(meeting.schedule.endAt!) }]);
    expect(day?.intervals).toEqual([{ start: Date.parse('2026-10-06T17:00:00Z'), end: Date.parse('2026-10-07T00:00:00Z') }]);
  });
  it('keeps transparent events, point deadlines and unscheduled suggestions free', () => {
    const value = workspace();
    value.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, showUndated: true };
    const transparent = createItem('Free event', 'event', now);
    transparent.schedule = { timezone: 'UTC', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T11:00:00Z' };
    transparent.external = { provider: 'google_calendar', connectionId: 'connection', sourceUrl: '', syncedAt: now.toISOString(), calendarId: 'calendar', eventId: 'free', readOnly: false, transparency: 'transparent' };
    const deadline = createItem('Deadline', 'task', now);
    deadline.schedule = { timezone: 'UTC', dueAt: '2026-10-06T12:00:00Z' };
    const unscheduled = createItem('Suggested task', 'task', now);
    unscheduled.schedule = { timezone: 'UTC', estimatedDuration: 'PT2H' };
    for (const item of [transparent, deadline, unscheduled]) value.items[item.id] = item;
    const [day] = freeTimeForRange(value, '2026-10-06', '2026-10-06', 30, now);
    expect(day?.busy).toEqual([]);
    expect(day?.intervals).toEqual([{ start: now.getTime(), end: Date.parse('2026-10-07T00:00:00Z') }]);
  });

  it('uses every scheduled item despite the current View filter and expands events plus travel by the buffer', () => {
    const value = workspace();
    const event = createItem('Private appointment name', 'event', now); event.id = 'appointment';
    event.schedule = { timezone: 'UTC', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T11:00:00Z', travelDuration: 'PT30M', travelBackDuration: 'PT30M' };
    value.items[event.id] = event;

    const [day] = freeTimeForRange(value, '2026-10-06', '2026-10-06', 30, now);
    expect(day?.intervals).toEqual([
      { start: Date.parse('2026-10-06T00:00:00Z'), end: Date.parse('2026-10-06T09:00:00Z') },
      { start: Date.parse('2026-10-06T12:00:00Z'), end: Date.parse('2026-10-07T00:00:00Z') },
    ]);
    const text = freeTimeShareText([day!], 'en', 'UTC');
    expect(text).toContain('09:00');
    expect(text).toContain('12:00');
    expect(text).not.toContain('Private appointment name');
  });

  it('treats all-day events as unavailable and caps the selected range at 31 days', () => {
    const value = workspace();
    const event = createItem('All day', 'event', now); event.id = 'all-day';
    event.schedule = { timezone: 'UTC', allDay: true, startAt: '2026-10-06T00:00:00Z', endAt: '2026-10-07T00:00:00Z' };
    value.items[event.id] = event;
    expect(freeTimeForRange(value, '2026-10-06', '2026-10-06', 30, now)[0]?.intervals).toEqual([]);
    expect(freeTimeForRange(value, '2026-10-06', '2026-11-06', 30, now)).toEqual([]);
  });

  it('does not count the Sleep item selected in Timeline settings as busy time', () => {
    const value = workspace();
    const sleep = createItem('Sleep', 'event', now); sleep.id = 'sleep';
    sleep.schedule = { timezone: 'UTC', startAt: '2026-10-06T00:00:00Z', endAt: '2026-10-06T08:00:00Z' };
    const meeting = createItem('Meeting', 'event', now); meeting.id = 'meeting';
    meeting.schedule = { timezone: 'UTC', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-06T11:00:00Z' };
    value.items[sleep.id] = sleep; value.items[meeting.id] = meeting;
    value.calendarPreferences.timeline = { mode: 'timeline', hideSleep: false, sleepItemId: sleep.id };
    const [day] = freeTimeForRange(value, '2026-10-06', '2026-10-06', 30, now);
    expect(day?.intervals).toEqual([
      { start: Date.parse('2026-10-06T08:00:00Z'), end: Date.parse('2026-10-06T09:30:00Z') },
      { start: Date.parse('2026-10-06T11:30:00Z'), end: Date.parse('2026-10-07T00:00:00Z') },
    ]);
    expect(day?.busy).toEqual([{ start: Date.parse('2026-10-06T09:30:00Z'), end: Date.parse('2026-10-06T11:30:00Z') }]);
    expect(day?.start).toBe(Date.parse('2026-10-06T08:00:00Z'));
    delete value.calendarPreferences.timeline.sleepItemId;
    expect(freeTimeForRange(value, '2026-10-06', '2026-10-06', 30, now)[0]?.intervals[0]?.start).toBe(Date.parse('2026-10-06T08:30:00Z'));
  });

  it('cuts recurring overnight Sleep from the chart and labels every waking hour', () => {
    const value = workspace();
    const sleep = createItem('Sleep', 'event', now); sleep.id = 'sleep'; sleep.role = 'series_template';
    sleep.schedule = { timezone: 'UTC', startAt: '2026-10-05T23:00:00Z', endAt: '2026-10-06T08:00:00Z' };
    sleep.recurrence = { rrule: 'FREQ=DAILY', rdates: [], exdates: [], timezone: 'UTC', autoRenew: false, anchor: 'schedule', closeAt: 'never' };
    value.items[sleep.id] = sleep;
    value.calendarPreferences.timeline = { mode: 'timeline', hideSleep: true, sleepItemId: sleep.id };
    const [day] = freeTimeForRange(value, '2026-10-06', '2026-10-06', 0, now);
    expect(day).toMatchObject({ start: Date.parse('2026-10-06T08:00:00Z'), end: Date.parse('2026-10-06T23:00:00Z') });
    expect(day?.intervals).toEqual([{ start: day?.start, end: day?.end }]);
    const marks = freeTimeScaleMarks(day!, 'UTC');
    expect(marks).toHaveLength(16);
    expect(marks[0]?.label).toBe('08:00');
    expect(marks.at(-1)?.label).toBe('23:00');
    expect(freeTimeShareText([day!], 'ru', 'UTC')).toContain('08:00–23:00');
  });

  it('formats text independently in every supported export language', () => {
    const days = [{ date: '2026-10-06', start: now.getTime(), end: now.getTime() + 86_400_000, intervals: [], busy: [], reserved: [], booked: [] }];
    expect(freeTimeShareText(days, 'ru', 'UTC')).toContain('нет свободных окон');
    expect(freeTimeShareText(days, 'es', 'UTC')).toContain('sin horarios libres');
    expect(freeTimeShareText(days, 'de', 'UTC')).toContain('keine freien Zeitfenster');
    expect(freeTimeShareText(days, 'fr', 'UTC')).toContain('aucun créneau libre');
    expect(freeTimeShareText(days, 'ko', 'UTC')).toContain('가능한 시간이 없습니다');
    expect(freeTimeShareTitle('ru')).toBe('Свободное время');
  });
});
