import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RecurrenceCompletionRecord } from '@utm/core';
import { RecurrenceHistorySection } from './RecurrenceHistorySection';

const completed: RecurrenceCompletionRecord = {
  seriesId: 'series', ownerItemId: 'occurrence', recurrenceId: '2026-09-01T09:00:00.000Z',
  completedAt: '2026-09-01T12:30:00.000Z', state: 'done', actor: 'user', reason: 'manual',
  storage: 'closure', timeRecorded: true, affectsNextCycle: true,
};

describe('RecurrenceHistorySection', () => {
  it('allows a manually completed cycle time to be edited', () => {
    const markup = renderToStaticMarkup(<RecurrenceHistorySection records={[completed]} language="en" onSave={() => undefined} />);

    expect(markup).toContain('Completion history');
    expect(markup).toContain('aria-label="Completion time for Cycle');
    expect(markup).toContain('Save time');
    expect(markup).toContain('Changing it also moves the next cycle.');
  });

  it('shows automatic closure history without an editable date control', () => {
    const markup = renderToStaticMarkup(<RecurrenceHistorySection records={[{ ...completed, state: 'auto_closed', actor: 'system', reason: 'auto_renew' }]} language="en" onSave={() => undefined} />);

    expect(markup).toContain('Auto closed');
    expect(markup).toContain('Read only');
    expect(markup).not.toContain('type="datetime-local"');
    expect(markup).not.toContain('Save time');
  });

  it('explains when a legacy habit tick stored only its date', () => {
    const markup = renderToStaticMarkup(<RecurrenceHistorySection records={[{ ...completed, storage: 'habit_date', recurrenceId: '2026-09-01', timeRecorded: false, affectsNextCycle: false }]} language="en" onSave={() => undefined} />);

    expect(markup).toContain('An older app stored only the completion date.');
  });
});
