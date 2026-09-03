import { describe, expect, it } from 'vitest';
import { defaultReminderPeriodValue, defaultSchedulePeriodValue, defaultVisualConditionForField, parseReminderPeriodValue, parseSchedulePeriodValue, parseVisualRows, reminderPeriodField, schedulePeriodField, serializeVisualRows, toSqlExpression, visualFieldKind, visualOperators, visualOptionsForField } from './visualFilterModel';

describe('visual filter model', () => {
  it('round-trips the existing visual DSL without changing its syntax', () => {
    const source = '(state == "open" && priority >= 2)';
    const rows = parseVisualRows(source);
    expect(rows).not.toBeNull();
    expect(serializeVisualRows(rows!)).toBe(source);
  });

  it('keeps type-sensitive operators and SQL preview', () => {
    expect(visualOperators('priority')).toContain('>=');
    expect(visualOperators('tags')).toContain('has any');
    expect(toSqlExpression('state == "open" && priority >= 2')).toBe('state = "open" AND priority >= 2');
  });

  it('does not offer presence checks for values that are always defined', () => {
    expect(visualOperators('activeRange')).toEqual(['==', '!=']);
    expect(visualOperators('activeRangeWhenSet')).toEqual(['==', '!=']);
    expect(visualOperators('isHabit')).toEqual(['==', '!=']);
    expect(visualOperators('state')).toEqual(['==', '!=']);
    expect(visualOperators('schedule.startAt')).toContain('is set');
    expect(visualOperators('schedule.allDay')).toContain('is set');
    expect(visualOperators('schedule.allDay')).not.toContain('in');
    expect(visualOperators('parentDepth')).not.toContain('is set');
    expect(defaultVisualConditionForField('activeRange')).toEqual({ operator: '==', value: 'true' });
    expect(defaultVisualConditionForField('activeRangeWhenSet')).toEqual({ operator: '==', value: 'true' });
    expect(defaultVisualConditionForField('state')).toEqual({ operator: '==', value: 'open' });
  });

  it('uses workspace custom-field types for operators, values and inputs', () => {
    const fields = {
      flag: { id: 'flag', key: 'flag', label: 'Flag', kind: 'boolean' as const, required: false },
      score: { id: 'score', key: 'score', label: 'Score', kind: 'number' as const, required: false },
      phase: { id: 'phase', key: 'phase', label: 'Phase', kind: 'enum' as const, required: false, options: ['draft', 'ready'] },
    };
    expect(visualFieldKind('custom.flag', fields)).toBe('boolean');
    expect(visualOperators('custom.flag', fields)).toEqual(['is set', 'is not set', '==', '!=']);
    expect(visualOperators('custom.score', fields)).toContain('>=');
    expect(visualOptionsForField('custom.phase', fields)).toEqual(['draft', 'ready']);
    expect(defaultVisualConditionForField('custom.phase', fields)).toEqual({ operator: '==', value: 'draft' });
  });

  it('upgrades legacy boolean presence rows to explicit boolean comparisons', () => {
    const rows = parseVisualRows('(activeRange != null && isHabit == null)');
    expect(rows).toMatchObject([
      { field: 'activeRange', operator: '==', value: 'true' },
      { field: 'isHabit', operator: '==', value: 'false' },
    ]);
    expect(serializeVisualRows(rows!)).toBe('(activeRange == true && isHabit == false)');
  });

  it('serializes Contains in the correct direction and keeps it editable', () => {
    const rows = [{ id: 'title', join: 'and' as const, field: 'title', operator: 'contains', value: 'готов' }];
    expect(serializeVisualRows(rows)).toBe('includes(title, "готов")');
    expect(parseVisualRows('includes(title, "готов")')).toMatchObject([{ field: 'title', operator: 'contains', value: 'готов' }]);
    expect(parseVisualRows('title in "готов"')).toMatchObject([{ field: 'title', operator: 'contains', value: 'готов' }]);
  });

  it('keeps obsolete type-invalid rows in advanced mode instead of rendering a broken select', () => {
    expect(parseVisualRows('state != null')).toBeNull();
    expect(parseVisualRows('length(parentDepth) > 0')).toBeNull();
  });

  it('round-trips the Google Calendar provider filter', () => {
    const source = 'external.provider == "google_calendar"';
    expect(visualOperators('external.provider')).toContain('==');
    const rows = parseVisualRows(source);
    expect(rows).toMatchObject([{ field: 'external.provider', operator: '==', value: 'google_calendar' }]);
    expect(serializeVisualRows(rows!)).toBe(source);
  });

  it('offers All day as a boolean visual filter', () => {
    const source = 'schedule.allDay != true';
    expect(visualOperators('schedule.allDay')).toEqual(expect.arrayContaining(['==', '!=']));
    const rows = parseVisualRows(source);
    expect(rows).toMatchObject([{ field: 'schedule.allDay', operator: '!=', value: 'true' }]);
    expect(serializeVisualRows(rows!)).toBe(source);
  });

  it('round-trips the reusable schedule period condition', () => {
    const value = { ...defaultSchedulePeriodValue(), period: 'tomorrow' as const, includeOverdue: true };
    const source = serializeVisualRows([{ id: 'period', join: 'and', field: schedulePeriodField, operator: 'matches', value: JSON.stringify(value) }]);
    expect(source).toBe('scheduleInPeriod("tomorrow", "event_open,active,due", true, 7, "", "")');
    const parsed = parseVisualRows(`(state == "open" && ${source})`);
    expect(parsed).not.toBeNull();
    expect(parsed?.[1]?.field).toBe(schedulePeriodField);
    expect(parseSchedulePeriodValue(parsed?.[1]?.value ?? '')).toMatchObject(value);
    expect(serializeVisualRows(parsed!)).toBe(`(state == "open" && ${source})`);
  });

  it('keeps reminder presence and reminder-period filters editable after saving', () => {
    expect(visualOperators('reminders')).toEqual(['is set', 'is not set']);
    expect(visualOperators('hasActiveReminders')).toContain('==');
    expect(visualOperators('nextReminderAt')).toContain('is set');
    const period = { ...defaultReminderPeriodValue(), period: 'next_days' as const, relation: 'after' as const, nextDays: 14 };
    const rows = [
      { id: 'any', join: 'and' as const, field: 'reminders', operator: 'is set', value: '' },
      { id: 'active', join: 'and' as const, field: 'hasActiveReminders', operator: '==', value: 'true' },
      { id: 'nearest', join: 'and' as const, field: 'nextReminderAt', operator: 'is set', value: '' },
      { id: 'period', join: 'and' as const, field: reminderPeriodField, operator: 'matches', value: JSON.stringify(period) },
    ];
    const source = serializeVisualRows(rows);
    expect(source).toContain('length(reminders) > 0');
    expect(source).toContain('nextReminderInPeriod("next_days", "after", 14');
    const parsed = parseVisualRows(source);
    expect(parsed).not.toBeNull();
    expect(parsed?.map((row) => [row.field, row.operator])).toEqual([
      ['reminders', 'is set'], ['hasActiveReminders', '=='], ['nextReminderAt', 'is set'], [reminderPeriodField, 'matches'],
    ]);
    expect(parseReminderPeriodValue(parsed?.at(-1)?.value ?? '')).toMatchObject(period);
    expect(serializeVisualRows(parsed!)).toBe(source);
  });

  it('restores legacy Today and This week presets as editable visual rows', () => {
    const active = 'state == "open" && role != "series_template" && isTemplate != true';
    const today = parseVisualRows(`${active} && (eventToday == true || dueTodayOrOverdue == true)`);
    const week = parseVisualRows(`${active} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`);
    expect(today).not.toBeNull();
    expect(week).not.toBeNull();
    expect(today?.map((row) => row.field)).toEqual(['state', 'isTemplate', schedulePeriodField]);
    expect(parseSchedulePeriodValue(today?.at(-1)?.value ?? '')).toMatchObject({ period: 'today', sources: ['event', 'due'], includeOverdue: true });
    expect(parseSchedulePeriodValue(week?.at(-1)?.value ?? '')).toMatchObject({ period: 'this_week', sources: ['event', 'due'], includeOverdue: true });
  });

  it('keeps the optional active-range guard editable', () => {
    const source = '(scheduleInPeriod("today", "event_open,event,active,due", true, 7, "", "") && activeRangeWhenSet == true)';
    const rows = parseVisualRows(source);
    expect(rows).not.toBeNull();
    expect(rows?.map((row) => row.field)).toEqual([schedulePeriodField, 'activeRangeWhenSet']);
    expect(serializeVisualRows(rows!)).toBe(source);
  });
});
