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
  it('places outward travel above the event and return travel below it with matching presets', () => {
    const item = createItem('Trip', 'event');
    item.schedule = { timezone: 'UTC', startAt: '2026-09-26T18:00:00Z', endAt: '2026-09-26T19:00:00Z', travelDuration: 'PT45M', travelBackDuration: 'PT30M' };
    const markup = renderToStaticMarkup(<DatesSection item={item} workspace={createWorkspace()} sectionMark={() => null} travelDuration={{ amount: 45, unit: 'minutes' }} travelBackDuration={{ amount: 30, unit: 'minutes' }} patchScheduledDuration={vi.fn()} patchTravelDuration={vi.fn()} patchTravelBackDuration={vi.fn()} patchScheduledStart={vi.fn()} patchScheduledEnd={vi.fn()} patchScheduledDue={vi.fn()} applyDurationPreset={vi.fn()} />);
    expect(markup.indexOf('Travel time ·')).toBeLessThan(markup.indexOf('aria-label="Event opens"'));
    expect(markup.indexOf('Travel back ·')).toBeGreaterThan(markup.indexOf('aria-label="Event ends"'));
    expect(markup.match(/class="program-actions"/g)).toHaveLength(2);
  });
  it('does not show Event ends before Event opens is set', () => {
    const item = createItem('Draft');
    const markup = renderToStaticMarkup(<DatesSection item={item} workspace={createWorkspace()} sectionMark={() => null} patchScheduledDuration={vi.fn()} patchTravelDuration={vi.fn()} patchScheduledStart={vi.fn()} patchScheduledEnd={vi.fn()} patchScheduledDue={vi.fn()} applyDurationPreset={vi.fn()} />);
    expect(markup).not.toContain('aria-label="Event ends"');
  });
  it('offers explicit date-only or timed Due without inventing a clock time', () => {
    const item = createItem('Deadline', 'task');
    item.schedule = { timezone: 'UTC', dueAt: '2026-09-23T23:59:59.999Z', dueDateOnly: true };
    const markup = renderToStaticMarkup(<DatesSection item={item} workspace={createWorkspace()} sectionMark={() => null} patchScheduledDuration={vi.fn()} patchTravelDuration={vi.fn()} patchScheduledStart={vi.fn()} patchScheduledEnd={vi.fn()} patchScheduledDue={vi.fn()} patchQuickDue={vi.fn()} applyDurationPreset={vi.fn()} />);
    expect(markup).toContain('aria-label="Due precision"');
    expect(markup).toContain('Due date without time');
    expect(markup).toContain('value="2026-09-23"');
    expect(markup).not.toContain('value="2026-09-23T09:00"');
  });
  it('offers a date-only Event ends for a date-only start and shows the inclusive last day', () => {
    const item = createItem('Trip', 'event');
    item.schedule = { timezone: 'Europe/Moscow', plannedDate: '2026-09-21' };
    const props = { item, workspace: createWorkspace(), sectionMark: () => null, patchScheduledDuration: vi.fn(), patchTravelDuration: vi.fn(), patchScheduledStart: vi.fn(), patchPlannedDate: vi.fn(), patchScheduledEnd: vi.fn(), patchDateOnlyEnd: vi.fn(), patchDateOnlyTimedEnd: vi.fn(), applyDurationPreset: vi.fn(), patchScheduledDue: vi.fn() };
    const initial = renderToStaticMarkup(<DatesSection {...props} />);
    expect(initial).toContain('aria-label="Event ends precision"');
    expect(initial).toContain('aria-label="Event ends date"');
    expect(initial).toContain('min="2026-09-21"');
    item.schedule = { timezone: 'Europe/Moscow', allDay: true, startAt: '2026-09-20T21:00:00.000Z', endAt: '2026-09-24T21:00:00.000Z' };
    const range = renderToStaticMarkup(<DatesSection {...props} />);
    expect(range).toContain('aria-label="Event opens date"');
    expect(range).toContain('aria-label="Event ends date"');
    expect(range).toContain('value="2026-09-24"');
  });
});
