import { describe, expect, it } from 'vitest';
import { defaultSchedulePeriodValue, parseSchedulePeriodValue, parseVisualRows, schedulePeriodField, serializeVisualRows, toSqlExpression, visualOperators } from './visualFilterModel';

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

  it('restores legacy Today and This week presets as editable visual rows', () => {
    const active = 'state == "open" && role != "series_template" && isTemplate != true';
    const today = parseVisualRows(`${active} && (eventToday == true || dueTodayOrOverdue == true)`);
    const week = parseVisualRows(`${active} && (eventThisWeek == true || dueThisWeekOrOverdue == true)`);
    expect(today).not.toBeNull();
    expect(week).not.toBeNull();
    expect(today?.map((row) => row.field)).toEqual(['state', 'role', 'isTemplate', schedulePeriodField]);
    expect(parseSchedulePeriodValue(today?.at(-1)?.value ?? '')).toMatchObject({ period: 'today', sources: ['event', 'due'], includeOverdue: true });
    expect(parseSchedulePeriodValue(week?.at(-1)?.value ?? '')).toMatchObject({ period: 'this_week', sources: ['event', 'due'], includeOverdue: true });
  });
});
