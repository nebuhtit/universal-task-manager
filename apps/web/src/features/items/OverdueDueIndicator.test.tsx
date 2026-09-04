import { createItem } from '@utm/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OverdueDueIndicator, overdueAgeWithoutActiveRange } from './OverdueDueIndicator';

const now = new Date('2026-09-04T13:00:00.000Z');

describe('due-only overdue indicator', () => {
  it('marks an open overdue item without a Start boundary', () => {
    const item = createItem('Counters');
    item.schedule = { timezone: 'UTC', dueAt: '2026-09-01T09:00:00.000Z' };
    expect(overdueAgeWithoutActiveRange(item, now)).toEqual({ value: 3, unit: 'day' });
    const markup = renderToStaticMarkup(<OverdueDueIndicator item={item} now={now} label="Overdue" />);
    expect(markup).toContain('item-overdue-due-indicator');
    expect(markup).toContain('>3d</span>');
  });

  it('does not mark future, completed, or Start-to-Due items', () => {
    const item = createItem('Not due-only overdue');
    item.schedule = { timezone: 'UTC', dueAt: '2026-09-05T09:00:00.000Z' };
    expect(overdueAgeWithoutActiveRange(item, now)).toBeNull();
    item.schedule.dueAt = '2026-09-01T09:00:00.000Z';
    item.schedule.startAt = '2026-08-31T09:00:00.000Z';
    expect(overdueAgeWithoutActiveRange(item, now)).toBeNull();
    delete item.schedule.startAt;
    item.state = 'done';
    expect(overdueAgeWithoutActiveRange(item, now)).toBeNull();
  });

  it('shows one hour during the first partial overdue hour', () => {
    const item = createItem('Just overdue');
    item.schedule = { timezone: 'UTC', dueAt: '2026-09-04T12:59:00.000Z' };
    expect(overdueAgeWithoutActiveRange(item, now)).toEqual({ value: 1, unit: 'hour' });
    expect(renderToStaticMarkup(<OverdueDueIndicator item={item} now={now} label="Overdue" />)).toContain('>1h</span>');
  });

  it('renders nothing when the preference is disabled', () => {
    const item = createItem('Late');
    item.schedule = { timezone: 'UTC', dueAt: '2026-09-03T08:00:00.000Z' };
    expect(renderToStaticMarkup(<OverdueDueIndicator item={item} now={now} label="Overdue" enabled={false} />)).toBe('');
  });
});
