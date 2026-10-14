import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldIcon, FieldIconLabel, fieldIconName } from './FieldIcon';

describe('field icons', () => {
  it('maps representative property families to stable semantic symbols', () => {
    expect(fieldIconName('title')).toBe('title');
    expect(fieldIconName('schedule.startAt')).toBe('start');
    expect(fieldIconName('calendar-settings')).toBe('calendar-settings');
    expect(fieldIconName('schedule.estimatedDuration')).toBe('duration-span');
    expect(fieldIconName('schedule.travelDuration')).toBe('travel-out');
    expect(fieldIconName('schedule.travelBackDuration')).toBe('travel-back');
    expect(fieldIconName('wristwatch')).toBe('wristwatch');
    expect(fieldIconName('schedule.dueAt')).toBe('due');
    expect(fieldIconName('tags')).toBe('tag');
    expect(fieldIconName('tag')).toBe('tag');
    expect(fieldIconName('recurrence.rrule')).toBe('repeat');
    expect(fieldIconName('recurrence.anchor')).toBe('start');
    expect(fieldIconName('recurrence.closeAt')).toBe('end');
    expect(fieldIconName('custom.client')).toBe('custom');
    expect(fieldIconName('script.time_left')).toBe('script');
    expect(fieldIconName('eventProgram')).toBe('program');
    expect(fieldIconName('script')).toBe('script');
    expect(fieldIconName('custom')).toBe('custom');
  });

  it('keeps the human label as a native tooltip while the icon stays decorative', () => {
    const html = renderToStaticMarkup(<FieldIcon path="schedule.startAt" label="Event opens" />);
    expect(html).toContain('title="Event opens"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('property-icon');
  });

  it('combines a decorative symbol with the visible editor label', () => {
    const html = renderToStaticMarkup(<FieldIconLabel path="priority" label="Priority" />);
    expect(html).toContain('property-label');
    expect(html).toContain('Priority');
    expect(html).toContain('property-icon');
  });
});
