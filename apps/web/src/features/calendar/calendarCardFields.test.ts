import { describe, expect, it } from 'vitest';
import { createWorkspace, migrateWorkspace, validateWorkspace } from '@utm/core';
import { calendarListFields, calendarTimelineFields } from './calendarCardFields';
import { displayViewValue } from '../items/fieldDisplay';

describe('calendar card fields', () => {
  it('keeps existing List fields while Timeline defaults to reminders without redundant dates', () => {
    const settings = createWorkspace().calendarPreferences.dayView;
    expect(calendarListFields(settings)).toContain('schedule.startAt');
    expect(calendarTimelineFields(settings)).not.toContain('schedule.startAt');
    expect(calendarTimelineFields(settings)).not.toContain('schedule.dueAt');
    expect(calendarTimelineFields(settings)).toContain('reminderTiming');
  });

  it('preserves independent user choices for List and Timeline', () => {
    const settings = { ...createWorkspace().calendarPreferences.dayView, listFields: ['title', 'schedule.endAt'], timelineFields: ['title', 'reminders', 'tags'] };
    expect(calendarListFields(settings)).toEqual(['title', 'schedule.endAt']);
    expect(calendarTimelineFields(settings)).toEqual(['title', 'reminders', 'tags']);
    const workspace = createWorkspace();
    workspace.calendarPreferences.dayView = settings;
    expect(validateWorkspace(workspace).valid).toBe(true);
    expect(migrateWorkspace(workspace).value.calendarPreferences.dayView.timelineFields).toEqual(['title', 'reminders', 'tags']);
  });

  it('renders reminder labels rather than raw reminder objects', () => {
    expect(displayViewValue([{ label: '15 min before start' }], 'reminders')).toBe('15 min before start');
  });
});
