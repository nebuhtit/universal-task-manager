import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuickItemTimer } from './QuickItemTimer';

describe('QuickItemTimer', () => {
  it('uses the item duration for a new timer', () => {
    expect(renderToStaticMarkup(<QuickItemTimer defaultDurationSeconds={2700} />)).toContain('45:00');
  });
  it('preserves second precision instead of rounding the countdown up to minutes', () => {
    const markup = renderToStaticMarkup(<QuickItemTimer defaultDurationSeconds={45} />);
    expect(markup).toContain('00:45');
    expect(markup).toContain('inputMode="text"');
    expect(markup).toContain('aria-label="Interval sound value"');
  });
  it('starts collapsed as a ten minute timer and also offers a stopwatch', () => {
    const markup = renderToStaticMarkup(<QuickItemTimer />);
    expect(markup).toContain('<details class="quick-item-timer"');
    expect(markup).not.toContain('<details class="quick-item-timer" open=""');
    expect(markup).toContain('Quick timer &amp; stopwatch');
    expect(markup).toContain('value="timer" selected=""');
    expect(markup).toContain('value="stopwatch"');
    expect(markup).toContain('value="10 min"');
    expect(markup).toContain('10:00');
  });
});
