import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DurationField } from './DurationField';

describe('DurationField', () => {
  it('stays editable without Event opens and offers 10 minutes first', () => {
    const markup = renderToStaticMarkup(<DurationField hasStart={false} onDurationChange={vi.fn()} onPreset={vi.fn()} />);
    expect(markup).toContain('<option value="10">10 min</option><option value="15">15 min</option>');
    expect(markup).toContain('aria-label="Calendar duration amount"');
    expect(markup).not.toContain('aria-label="Calendar duration amount" disabled=""');
    expect(markup).toContain('<option value="until-sleep" disabled="">Until sleep</option>');
    expect(markup).toContain('<option value="all-day" disabled="">All day</option>');
  });

  it('shows a saved independent estimate without creating dates', () => {
    const markup = renderToStaticMarkup(<DurationField hasStart={false} duration={{ amount: 45, unit: 'minutes' }} onDurationChange={vi.fn()} onPreset={vi.fn()} />);
    expect(markup).toContain('value="45"');
    expect(markup).toContain('<option value="minutes" selected="">Minutes</option>');
  });
});
