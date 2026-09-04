import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimerHistorySection } from './TimerHistorySection';

describe('TimerHistorySection', () => {
  it('keeps completed sessions in a separate collapsed history section', () => {
    const markup = renderToStaticMarkup(<TimerHistorySection language="en" records={[{
      id: 'timer-1', mode: 'timer', startedAt: '2026-09-04T10:00:00.000Z', endedAt: '2026-09-04T10:10:00.000Z', durationSeconds: 600, targetSeconds: 600,
    }]} />);
    expect(markup).toContain('<details class="timer-history">');
    expect(markup).toContain('Timer history');
    expect(markup).toContain('00:10:00');
  });
});
