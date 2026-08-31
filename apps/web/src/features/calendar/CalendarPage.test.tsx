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
    expect((markup.match(/calendar-day-choice/g) ?? [])).toHaveLength(7);
    expect(markup).not.toContain('full-calendar');
    expect(markup).not.toContain('timeGrid');
    expect(markup).not.toContain('Unscheduled');
  });

  it('offers week/month navigation, a Saved view filter and daily time metrics', () => {
    const markup = renderCalendar(true);
    expect(markup).toContain('Week');
    expect(markup).toContain('Month');
    expect(markup).toContain('All scheduled items');
    expect(markup).toContain('30min');
    expect(markup).toContain('free 23h 30min');
    expect(markup).toContain('Calendar settings');
  });

  it('uses semantic tokens and mobile horizontal week navigation', () => {
    const css = readFileSync(fileURLToPath(new URL('./calendar.css', import.meta.url)), 'utf8');
    expect(css).toContain('overflow-x: auto');
    expect(css).toContain('grid-template-columns: repeat(7');
    expect(css).toContain('var(--color-surface)');
    expect(css).toContain('var(--color-text)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
