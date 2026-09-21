import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { DatesSection } from './DatesSection';

const render = (allDay = false, travelDuration?: string) => {
  const item = createItem('Meeting', 'event');
  item.schedule = { timezone: 'UTC', startAt: '2026-09-21T10:00:00Z', endAt: '2026-09-21T11:00:00Z', ...(allDay ? { allDay: true } : {}), ...(travelDuration ? { travelDuration } : {}) };
  return renderToStaticMarkup(<DatesSection item={item} workspace={createWorkspace()} sectionMark={() => null} patchScheduledDuration={vi.fn()} patchTravelDuration={vi.fn()} patchScheduledStart={vi.fn()} patchScheduledEnd={vi.fn()} patchScheduledDue={vi.fn()} applyDurationPreset={vi.fn()} {...(travelDuration ? { travelDuration: { amount: 30, unit: 'minutes' as const } } : {})} />);
};

describe('DatesSection travel time', () => {
  it('shows a collapsed compact control only for a timed event', () => {
    const markup = render(false, 'PT30M');
    expect(markup).toContain('<details class="ui-disclosure travel-time-disclosure">');
    expect(markup).toContain('Travel time · 30 min');
    expect(markup).not.toContain('<details class="ui-disclosure travel-time-disclosure" open="">');
  });
  it('keeps all-day travel metadata out of the editor', () => expect(render(true, 'PT30M')).not.toContain('Travel time'));
});
