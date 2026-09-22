import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWorkspace, plannedDateForDisplay, validateWorkspace, compileQuery, makeSeries } from '@utm/core';
import { parseLiveEntry } from '../../../quick-entry-lab/parser';
import { createQuickEntryItem, applyQuickEntryText, quickEntrySource } from './quickEntry';
import { DueQuickChoices } from './DueQuickChoices';
import { timelineData } from '../calendar/timelineData';
import { evaluateCalendarRange } from '../calendar/calendarEvaluation';

const now = new Date(2026, 8, 22, 12);
it('uses the selected calendar day only when input has no explicit date', () => {
  const item = createQuickEntryItem('Отчёт 2ч', now, '2026-10-04');
  expect(item.schedule?.plannedDate).toBe('2026-10-04');
  expect(parseLiveEntry(quickEntrySource(item)!.text, now).plannedDate).toBe('2026-10-04');
  expect(createQuickEntryItem('Отчёт завтра', now, '2026-10-04').schedule?.plannedDate).toBe('2026-09-23');
  const timed = createQuickEntryItem('Встреча 15:00', now, '2026-10-04');
  expect(new Date(timed.schedule!.startAt!).getDate()).toBe(4);
  expect(new Date(timed.schedule!.startAt!).getMonth()).toBe(9);
  expect(createQuickEntryItem('Отчёт срок завтра 18:00', now, '2026-10-04').schedule?.plannedDate).toBeUndefined();
});
it('supports date-only series with Due without inventing a start time', () => {
  const item = createQuickEntryItem('Отчёт завтра срок пятница 18:00', now);
  const series = makeSeries(item, 'FREQ=DAILY');
  expect(series.schedule?.plannedDate).toBe(item.schedule?.plannedDate);
  expect(series.schedule?.startAt).toBeUndefined();
  expect(series.recurrence?.closeAt).toBe('never');
});
it.each(['Купить продукты завтра', 'Отчёт в пятницу 2ч', 'Отчёт 13 марта 27'])('captures date-only without guessed time: %s', text => {
  const draft = parseLiveEntry(text, now);
  expect(draft.errors).toEqual([]);
  expect(draft.plannedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(draft.start).toBeNull(); expect(draft.end).toBeNull();
  const item = createQuickEntryItem(text, now);
  expect(item.schedule?.plannedDate).toBe(draft.plannedDate);
  expect(item.schedule?.startAt).toBeUndefined(); expect(item.schedule?.endAt).toBeUndefined();
  expect(item.reminders).toHaveLength(0);
  const restored = parseLiveEntry(quickEntrySource(item)!.text, now);
  expect(restored.plannedDate).toBe(draft.plannedDate);
  expect(restored.start).toBeNull();
  if (text.includes('2ч')) { expect(item.schedule?.estimatedDuration).toBe('PT120M'); expect(item.title).toBe('Отчёт'); }
  const w = createWorkspace(); w.items[item.id] = item;
  expect(validateWorkspace(w).valid).toBe(true);
});
it('preserves explicit clocks and a separate deadline', () => {
  expect(createQuickEntryItem('Встреча завтра 15:00', now).schedule?.startAt).toBeDefined();
  expect(createQuickEntryItem('Встреча завтра 15:00', now).schedule?.plannedDate).toBeUndefined();
  const item = createQuickEntryItem('Отчёт завтра срок пятница 18:00', now);
  expect(item.schedule?.plannedDate).toBe('2026-09-23'); expect(item.schedule?.dueAt).toBeDefined();
  expect(applyQuickEntryText(item, 'Отчёт завтра 15:00', now).item.schedule?.plannedDate).toBeUndefined();
});
it('carries only open overdue tasks to today without changing the original date', () => {
  const item = createQuickEntryItem('Отчёт 21.09.2026 2ч', now);
  const w = createWorkspace(); w.calendarPreferences.timezone = 'UTC'; w.calendarPreferences.dayView.filter.source = 'true';
  w.items[item.id] = item;
  const before = JSON.stringify(w);
  expect(plannedDateForDisplay(item, now, 'UTC')).toBe('2026-09-22');
  expect(compileQuery('scheduleInPeriod("today", "event", false, 7, "", "")', undefined, { timeZone: 'UTC' })(item, now)).toBe(true);
  expect(timelineData(w, '2026-09-22', now).planning.proposals).toHaveLength(1);
  expect(timelineData(w, '2026-09-23', now).planning.proposals).toHaveLength(0);
  const calendar = evaluateCalendarRange(w, '2026-09-22', '2026-09-23', w.calendarPreferences.dayView, now);
  expect(calendar.days['2026-09-22']?.entries.map(entry => entry.item.id)).toContain(item.id);
  expect(JSON.stringify(w)).toBe(before);
  item.state = 'done'; expect(plannedDateForDisplay(item, now, 'UTC')).toBe('2026-09-21');
  expect(timelineData(w, '2026-09-22', now).planning.proposals).toHaveLength(0);
});
it('offers date-only rescheduling without datetime inputs or guessed clock times', () => {
  const item = createQuickEntryItem('Отчёт завтра', now);
  const html = renderToStaticMarkup(<DueQuickChoices item={item} now={now} language="ru" onChoose={() => {}} />);
  expect(html).toContain('type="date"'); expect(html).not.toContain('datetime-local'); expect(html).not.toContain('09:00');
});
