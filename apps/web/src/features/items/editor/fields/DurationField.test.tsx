import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DurationField } from './DurationField';

describe('DurationField', () => {
  it('stays editable without Event opens', () => {
    const markup = renderToStaticMarkup(<DurationField onDurationChange={vi.fn()} />);
    expect(markup).toContain('aria-label="Calendar duration amount"');
    expect(markup).toContain('inputMode="text"');
    expect(markup).not.toContain('aria-label="Calendar duration amount" disabled=""');
  });

  it('shows a saved independent estimate without creating dates', () => {
    const markup = renderToStaticMarkup(<DurationField duration={{ amount: 45, unit: 'minutes' }} onDurationChange={vi.fn()} />);
    expect(markup).toContain('value="45"');
    expect(markup).toContain('<option value="minutes" selected="">Minutes</option>');
  });
});
