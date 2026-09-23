import { describe, expect, it } from 'vitest';
import { duration, parseLiveEntry } from './parser';
import { extractOrganization, organizationSuggestions } from './organization';
import { applyQuickEntryText, createQuickEntryItem, quickEntrySource, syncQuickEntrySource } from '../src/features/items/quickEntry';
import { returnTravelInterval } from '../src/features/calendar/timelineLayout';
import { occupiedIntervals, viewPeriodBoundsForDates } from '@utm/core';

const now = new Date(2026, 8, 22, 12, 0);
describe('natural bilingual durations and return travel', () => {
  it.each([['полчаса', 30], ['полтора часа', 90], ['неделю', 10080], ['half an hour', 30], ['an hour and a half', 90], ['a week', 10080], ['3 дня 2ч 15мин', 4455]] as const)('%s', (text, minutes) => expect(duration(text)).toBe(minutes));
  it.each(['зарядка 15м', 'зарядка дл 15м', 'зарядка dr 15m'])('duration %s', text => {
    const draft = parseLiveEntry(text, now); expect(draft.errors).toEqual([]); expect(draft.title).toBe('зарядка'); expect(draft.durationMinutes).toBe(15);
  });
  it('composite bare duration', () => {
    const draft = parseLiveEntry('работа 2ч 3м', now); expect(draft.errors).toEqual([]); expect(draft.title).toBe('работа'); expect(draft.durationMinutes).toBe(123);
  });
  it.each(['ттб 30м', 'ttb 30m', 'туда и обратно по 30 мин'])('both directions %s', command => {
    const draft = parseLiveEntry(`Стрижка завтра 19:00 ${command}`, now); expect(draft.errors).toEqual([]); expect(draft.travelMinutes).toBe(30); expect(draft.travelBackMinutes).toBe(30);
  });
  it.each(['нап через полчаса', 'remind me in half an hour', 'remind in 30m'])('relative reminder %s', command => {
    const draft = parseLiveEntry(`Звонок ${command}`, now); expect(draft.errors).toEqual([]); expect(draft.title).toBe('Звонок'); expect(draft.reminders[0]?.at).toBe(new Date(now.getTime() + 30 * 60000).toISOString());
  });
  it.each(['н за 2ч 1д', 'r за 2ч 1д', 'н за 2ч н за 1д'])('multiple reminders %s', command => {
    const draft = parseLiveEntry(`Стрижка завтра 19:00 ${command}`, now);
    expect(draft.errors).toEqual([]); expect(draft.reminders.map(value => value.minutes)).toEqual([-120, -1440]);
  });
  it('organization aliases and escaped commands', () => {
    expect(extractOrganization('Текст п Работа э Дом #важно').projects).toEqual(['Работа']);
    expect(extractOrganization('Текст p Work ar Home tag urgent').areas).toEqual(['Home']);
    const draft = parseLiveEntry('.н .p .#метка .завтра', now);
    expect(draft.isNote).toBeUndefined(); expect(draft.reminders).toEqual([]); expect(draft.plannedDate).toBeUndefined(); expect(draft.title).toBe('.н .p .#метка .завтра');
    expect(parseLiveEntry('. текст п Работа', now).isNote).toBe(true);
    expect(organizationSuggestions('pro', 3, { area: [], project: [], tag: [] })?.options[0]?.label).toBe('project');
  });
  it.each(['во вт стрижка в 19 нап за 2ч 1д', 'нап за 2ч 1д во вт стрижка в 19'])('free command order %s', text => {
    const draft = parseLiveEntry(text, now); expect(draft.errors).toEqual([]); expect(draft.title).toBe('стрижка'); expect(new Date(draft.start!).getHours()).toBe(19); expect(draft.reminders).toHaveLength(2);
  });
  it.each(['напомни в след чт', 'remind me next thu'])('next week %s', command => {
    const draft = parseLiveEntry(`Звонок ${command}`, now); expect(draft.errors).toEqual([]); const date = new Date(draft.reminders[0]!.at!); expect(date.getDate()).toBe(1); expect(date.getHours()).toBe(9);
  });
  it.each(['на завтра', 'в эту пятницу', 'в следующий четверг'])('date preposition %s', command => {
    const draft = parseLiveEntry(`Задача ${command}`, now); expect(draft.title).toBe('Задача'); expect(draft.plannedDate).toBeTruthy();
  });
  it.each(['с 19 до 21', '19–21', 'с 19:00 до 21:00', 'from 19 to 21'])('clock range %s', command => {
    const draft = parseLiveEntry(`Встреча ${command}`, now); expect(draft.errors).toEqual([]); expect(draft.title).toBe('Встреча'); expect(new Date(draft.start!).getHours()).toBe(19); expect(new Date(draft.end!).getHours()).toBe(21);
  });
  it.each(['н 30м', 'r 30m', 'remind me 30m'])('short reminder %s', command => {
    const draft = parseLiveEntry(`Встреча завтра 19:00 ${command}`, now); expect(draft.errors).toEqual([]); expect(draft.reminders.map(value => value.minutes)).toEqual([-30]);
  });
  it.each(['нап за сутки', 'нап за полчаса до начала', 'нап за час до выезда', 'remind me half an hour before start', 'remind me 2h and 1d before start'])('natural offset %s', command => {
    const draft = parseLiveEntry(`Встреча завтра 19:00 дорога 30м ${command}`, now); expect(draft.errors).toEqual([]); expect(draft.reminders.length).toBeGreaterThan(0);
  });
  it('duration with на', () => { const draft = parseLiveEntry('Зарядка на 45 минут', now); expect(draft.title).toBe('Зарядка'); expect(draft.durationMinutes).toBe(45); });
  it.each(['н через 3 дня 2ч 15мин', 'remind me in half an hour', 'н через полтора часа', 'н через неделю'])('freezes relative reminders %s', command => {
    const item = createQuickEntryItem(`Звонок ${command}`, now);
    const again = applyQuickEntryText(item, quickEntrySource(item)!.text, new Date(now.getTime() + 3600000)).item;
    expect(again.reminders.map(value => value.at)).toEqual(item.reminders.map(value => value.at));
  });
  it('return travel survives source roundtrip and manual edit independently', () => {
    const item = createQuickEntryItem('Встреча завтра 19:00 ттб 30м', now);
    const changed = syncQuickEntrySource(item, { ...item, schedule: { ...item.schedule!, travelBackDuration: 'PT1H' } });
    const again = applyQuickEntryText(changed, quickEntrySource(changed)!.text, now).item;
    expect(again.schedule?.travelDuration).toBe('PT30M'); expect(again.schedule?.travelBackDuration).toBe('PT60M');
    const interval = returnTravelInterval(again)!;
    expect(interval.start).toBe(Date.parse(again.schedule!.endAt!)); expect(interval.end - interval.start).toBe(3600000);
    const busy = occupiedIntervals(again, viewPeriodBoundsForDates('2026-09-22', '2026-09-25'));
    expect(busy.reduce((sum, value) => sum + value.end - value.start, 0)).toBe(150 * 60000);
  });
});
