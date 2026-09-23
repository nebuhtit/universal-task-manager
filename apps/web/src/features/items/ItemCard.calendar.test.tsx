import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { ItemCard } from './ItemCard';

describe('calendar list card', () => {
  it('shows the clock but not the duplicate calendar date', () => {
    const workspace = createWorkspace();
    workspace.calendarPreferences.timezone = 'Europe/Moscow';
    const item = createItem('Meeting', 'event');
    item.schedule = { timezone: 'Europe/Moscow', startAt: '2026-09-23T12:00:00.000Z', endAt: '2026-09-23T13:00:00.000Z' };
    const markup = renderToStaticMarkup(<ItemCard item={item} workspace={workspace} fields={['title', 'schedule.startAt']} calendarTimeOnly onEdit={() => {}} onState={() => {}} />);
    expect(markup).toContain('15:00');
    expect(markup).not.toContain('23 Sep');
  });
});
