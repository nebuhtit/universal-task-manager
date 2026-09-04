import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QuickItemTimer } from './QuickItemTimer';

describe('QuickItemTimer', () => {
  it('starts as a ten minute timer and also offers a stopwatch', () => {
    const markup = renderToStaticMarkup(<QuickItemTimer />);
    expect(markup).toContain('value="timer" selected=""');
    expect(markup).toContain('value="stopwatch"');
    expect(markup).toContain('value="10"');
    expect(markup).toContain('10:00');
  });
});
