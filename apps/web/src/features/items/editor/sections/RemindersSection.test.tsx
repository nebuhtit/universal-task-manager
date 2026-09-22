import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createItem, reminderTime } from '@utm/core';
import { RemindersSection } from './RemindersSection';

describe('RemindersSection snooze', () => {
  it('shows the effective next alert separately from the original reminder time', () => {
    const item = createItem('Meeting');
    item.reminders = [{ id: 'reminder-1', mode: 'absolute', at: '2026-09-22T09:00:00Z', snoozedUntil: '2026-09-22T11:00:00Z', urgency: 'normal', repeatUntilAcknowledged: false }];
    expect(reminderTime(item, item.reminders[0]!)).toBe('2026-09-22T11:00:00.000Z');
    const markup = renderToStaticMarkup(<RemindersSection item={item} now={new Date('2026-09-22T10:00:00Z')} sectionMark={() => null} patchItem={vi.fn()} />);
    expect(markup).toContain('Next alert:');
    expect(markup).toContain('original schedule shown above');
    expect(markup).toContain('Cancel snooze');
    expect(markup).toContain('aria-label="Reminder 1 time"');
  });
});
