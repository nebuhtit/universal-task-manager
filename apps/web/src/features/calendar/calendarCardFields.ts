import type { CalendarDayViewPreferences } from '@utm/core';

const scheduleClockFields = new Set([
  'schedule.plannedDate', 'schedule.startAt', 'schedule.endAt',
  'schedule.dueAt', 'schedule.availableFrom',
]);

export function calendarListFields(settings: CalendarDayViewPreferences): string[] {
  return settings.listFields ?? settings.fields;
}

export function calendarTimelineFields(settings: CalendarDayViewPreferences): string[] {
  return settings.timelineFields ?? [...new Set([...settings.fields.filter(field => !scheduleClockFields.has(field)), 'reminders'])];
}
