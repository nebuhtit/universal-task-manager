import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { CalendarPage } from './CalendarPage';

vi.mock('@fullcalendar/react', () => ({
  default: ({
    initialView,
    editable,
    selectable,
    droppable,
    nowIndicator,
    slotMinTime,
    slotMaxTime,
    events,
  }: Record<string, unknown>) => <div
    data-testid="full-calendar"
    data-initial-view={String(initialView)}
    data-editable={String(editable)}
    data-selectable={String(selectable)}
    data-droppable={String(droppable)}
    data-now-indicator={String(nowIndicator)}
    data-slot-min={String(slotMinTime)}
    data-slot-max={String(slotMaxTime)}
    data-event-count={String((events as unknown[]).length)}
  />,
}));
vi.mock('@fullcalendar/react/daygrid', () => ({ default: {} }));
vi.mock('@fullcalendar/react/timegrid', () => ({ default: {} }));
vi.mock('@fullcalendar/react/list', () => ({ default: {} }));
vi.mock('@fullcalendar/react/interaction', () => ({
  default: {},
  Draggable: class { destroy() {} },
}));

describe('CalendarPage baseline contract', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerWidth: 1024 },
    });
  });

  it('keeps the full calendar interaction and 24-hour timeline contract', () => {
    const workspace = createWorkspace('Calendar', new Date('2026-08-26T10:00:00.000Z'));
    const item = createItem('Timed item', 'task', new Date('2026-08-26T10:00:00.000Z'));
    item.schedule = {
      timezone: 'UTC',
      startAt: '2026-08-26T10:00:00.000Z',
      endAt: '2026-08-26T10:30:00.000Z',
    };
    workspace.items[item.id] = item;

    const markup = renderToStaticMarkup(<CalendarPage
      workspace={workspace}
      commit={vi.fn()}
      onEditItem={vi.fn()}
      createUiItem={(title, preset, now) => createItem(title ?? '', preset, now)}
    />);

    expect(markup).toContain('data-initial-view="dayGridMonth"');
    expect(markup).toContain('data-editable="true"');
    expect(markup).toContain('data-selectable="true"');
    expect(markup).toContain('data-droppable="true"');
    expect(markup).toContain('data-now-indicator="true"');
    expect(markup).toContain('data-slot-min="00:00:00"');
    expect(markup).toContain('data-slot-max="24:00:00"');
    expect(markup).toContain('data-event-count="1"');
  });

  it('keeps all modes, saved-view filtering, state filters and unscheduled access visible', () => {
    const workspace = createWorkspace('Calendar');
    const markup = renderToStaticMarkup(<CalendarPage
      workspace={workspace}
      commit={vi.fn()}
      onEditItem={vi.fn()}
      createUiItem={(title, preset, now) => createItem(title ?? '', preset, now)}
    />);

    expect(markup).toContain('month');
    expect(markup).toContain('week');
    expect(markup).toContain('day');
    expect(markup).toContain('agenda');
    expect(markup).toContain('Saved view');
    expect(markup).toContain('All active + completed');
    expect(markup).toContain('Active');
    expect(markup).toContain('Completed');
    expect(markup).toContain('Auto closed');
    expect(markup).toContain('Cancelled');
    expect(markup).toContain('Archived');
    expect(markup).toContain('Unscheduled (0)');
  });

  it('owns semantic, horizontally scrollable calendar styling outside legacy CSS', () => {
    const calendarCss = readFileSync(fileURLToPath(new URL('./calendar.css', import.meta.url)), 'utf8');
    const legacyCss = readFileSync(fileURLToPath(new URL('../../styles/legacy.css', import.meta.url)), 'utf8');

    expect(calendarCss).toContain('overflow: auto');
    expect(calendarCss).toContain('min-width: 680px');
    expect(calendarCss).toContain('var(--color-surface)');
    expect(calendarCss).toContain('var(--color-text)');
    expect(calendarCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(legacyCss).not.toContain('.calendar-main-panel');
    expect(legacyCss).not.toContain('.unscheduled-panel');
  });
});
