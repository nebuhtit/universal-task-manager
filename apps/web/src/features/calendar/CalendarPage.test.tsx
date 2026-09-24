import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { CalendarPage } from './CalendarPage';

const renderCalendar = (withItem = false) => {
  const now = new Date('2026-08-26T10:00:00.000Z');
  const workspace = createWorkspace('Calendar', now);
  workspace.calendarPreferences.timezone = 'UTC';
  if (withItem) {
    const item = createItem('Timed item', 'task', now);
    item.schedule = { timezone: 'UTC', startAt: now.toISOString(), endAt: '2026-08-26T10:30:00.000Z', estimatedDuration: 'PT30M' };
    workspace.items[item.id] = item;
  }
  return renderToStaticMarkup(<CalendarPage
    workspace={workspace}
    now={now}
    commit={vi.fn()}
    onEditItem={vi.fn()}
    onState={vi.fn()}
    createUiItem={(title, preset, createdAt) => createItem(title ?? '', preset, createdAt)}
  />);
};

describe('CalendarPage daily-list contract', () => {
  it('renders one selected day as the shared list view without a timeline', () => {
    const markup = renderCalendar(true);
    expect(markup).toContain('Timed item');
    expect(markup).toContain('calendar-day-list');
    expect(markup).toContain('calendar-day-panel is-week');
    expect(markup).toContain('calendar-day-choice selected today');
    expect(markup).toContain('aria-current="date"');
    expect((markup.match(/calendar-day-choice/g) ?? [])).toHaveLength(7);
    expect(markup).not.toContain('full-calendar');
    expect(markup).not.toContain('timeGrid');
    expect(markup).not.toContain('Unscheduled');
  });

  it('offers week/month navigation, day-view editing and daily time metrics', () => {
    const markup = renderCalendar(true);
    expect(markup).toContain('Week');
    expect(markup).toContain('Month');
    expect(markup).not.toContain('All scheduled items');
    expect(markup).toContain('30min');
    expect(markup).toContain('Free 13h 30min');
    expect(markup).toContain('Edit calendar day view');
  });

  it('shows an active Event opens to Due range on every intersected day', () => {
    const now = new Date('2026-08-26T10:00:00.000Z');
    const workspace = createWorkspace('Calendar', now);
    workspace.calendarPreferences.timezone = 'UTC';
    const item = createItem('Spanning active range', 'task', now);
    item.schedule = { timezone: 'UTC', startAt: '2026-08-25T08:00:00.000Z', dueAt: '2026-08-27T18:00:00.000Z', estimatedDuration: 'PT1H' };
    workspace.items[item.id] = item;
    const markup = renderToStaticMarkup(<CalendarPage workspace={workspace} now={now} commit={vi.fn()} onEditItem={vi.fn()} onState={vi.fn()} createUiItem={(title, preset, createdAt) => createItem(title ?? '', preset, createdAt)} />);
    expect(markup).toContain('Spanning active range');
  });
  it('renders shared Overdue and No date controls without duplicating undated cards', () => {
    const now = new Date('2026-08-26T10:00:00.000Z');
    const workspace = createWorkspace('Calendar', now);
    workspace.calendarPreferences.timezone = 'UTC'; workspace.calendarPreferences.dayView.filter.source = 'true';
    workspace.calendarPreferences.timeline = { mode: 'list', hideSleep: false, showUndated: true, showOverdue: true };
    const late = createItem('Late item', 'task', now); late.schedule = { timezone: 'UTC', dueAt: '2026-08-25T09:00:00Z' };
    const undated = createItem('Undated item', 'task', now);
    workspace.items[late.id] = late; workspace.items[undated.id] = undated;
    const markup = renderToStaticMarkup(<CalendarPage workspace={workspace} now={now} commit={vi.fn()} onEditItem={vi.fn()} onState={vi.fn()} createUiItem={(title, preset, createdAt) => createItem(title ?? '', preset, createdAt)} />);
    expect(markup).toContain('calendar-list-toolbar');
    expect(markup).toContain('Overdue · 1'); expect(markup).toContain('No date · 1');
    expect((markup.match(new RegExp(`data-utm-item-id="${undated.id}"`, 'g')) ?? [])).toHaveLength(1);
    expect(markup).toContain('Late item');
  });

  it('shows an unplaced task capacity warning once beside its placement action', () => {
    const now = new Date('2026-08-26T10:00:00.000Z');
    const workspace = createWorkspace('Calendar', now);
    workspace.calendarPreferences.timezone = 'UTC'; workspace.calendarPreferences.dayView.filter.source = 'true'; workspace.calendarPreferences.timeline = { mode: 'list', hideSleep: false, showUndated: true };
    const task = createItem('На великах покататься', 'task', now);
    task.schedule = { timezone: 'UTC', estimatedDuration: 'PT1H' };
    const busy = createItem('Busy all day', 'event', now);
    busy.schedule = { timezone: 'UTC', startAt: now.toISOString(), endAt: '2026-08-27T00:00:00.000Z' };
    workspace.items[task.id] = task; workspace.items[busy.id] = busy;
    const markup = renderToStaticMarkup(<CalendarPage workspace={workspace} now={now} commit={vi.fn()} onEditItem={vi.fn()} onState={vi.fn()} createUiItem={(title, preset, createdAt) => createItem(title ?? '', preset, createdAt)} />);
    const warning = 'No continuous free slot. The item remains outside the schedule.';
    expect(markup).toContain('Parallel / Queue');
    expect(markup.split(warning)).toHaveLength(2);
  });

  it('uses semantic tokens and a seven-column mobile week navigator', () => {
    const css = readFileSync(fileURLToPath(new URL('./calendar.css', import.meta.url)), 'utf8');
    expect(css).toContain('overflow: hidden');
    expect(css).toContain('grid-template-columns: repeat(7');
    expect(css).toContain('var(--color-surface)');
    expect(css).toContain('var(--color-text)');
    expect(css).toContain('.calendar-day-choice.today:not(.selected)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
