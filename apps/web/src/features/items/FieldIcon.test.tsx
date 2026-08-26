import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldIcon, fieldIconName } from './FieldIcon';

describe('field icons', () => {
  it('maps representative property families to stable semantic symbols', () => {
    expect(fieldIconName('title')).toBe('title');
    expect(fieldIconName('schedule.startAt')).toBe('start');
    expect(fieldIconName('schedule.dueAt')).toBe('due');
    expect(fieldIconName('tags')).toBe('tag');
    expect(fieldIconName('recurrence.rrule')).toBe('repeat');
    expect(fieldIconName('custom.client')).toBe('custom');
    expect(fieldIconName('script.time_left')).toBe('script');
  });

  it('keeps the human label as a native tooltip while the icon stays decorative', () => {
    const html = renderToStaticMarkup(<FieldIcon path="schedule.startAt" label="Event opens" />);
    expect(html).toContain('title="Event opens"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('property-icon');
  });
});
