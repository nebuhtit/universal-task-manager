import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ItemSetMetrics } from '@utm/core';
import { formatCompactRemainingDuration, formatViewMetricsSummary, ViewMetricsSummary } from './ViewMetricsSummary';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe('ViewMetricsSummary', () => {
  it('formats the requested duration tiers and keeps a meaningful second unit', () => {
    expect(formatCompactRemainingDuration(35 * minute, 'ru')).toBe('35мин');
    expect(formatCompactRemainingDuration(5 * hour + 20 * minute, 'ru')).toBe('5ч 20мин');
    expect(formatCompactRemainingDuration(25 * hour, 'ru')).toBe('1д 1ч');
    expect(formatCompactRemainingDuration(3 * day + 4 * hour, 'ru')).toBe('3д 4ч');
    expect(formatCompactRemainingDuration(65 * day, 'ru')).toBe('2мес 5д');
    expect(formatCompactRemainingDuration((365 + 63) * day, 'ru')).toBe('1г 2мес 3д');
  });

  it('rounds up to the smallest displayed unit without showing zero parts', () => {
    expect(formatCompactRemainingDuration(1, 'en')).toBe('1min');
    expect(formatCompactRemainingDuration(24 * hour + minute, 'en')).toBe('1d 1h');
    expect(formatCompactRemainingDuration(30 * day + hour, 'en')).toBe('1mo 1d');
  });

  it('uses compact units for every supported interface language', () => {
    expect(formatCompactRemainingDuration(2 * hour + 15 * minute, 'en')).toBe('2h 15min');
    expect(formatCompactRemainingDuration(2 * hour + 15 * minute, 'es')).toBe('2h 15min');
    expect(formatCompactRemainingDuration(2 * hour + 15 * minute, 'de')).toBe('2Std 15Min');
    expect(formatCompactRemainingDuration(2 * hour + 15 * minute, 'fr')).toBe('2h 15min');
    expect(formatCompactRemainingDuration(2 * hour + 15 * minute, 'ko')).toBe('2시간 15분');
  });

  it('hides zero values and removes the separator when only one result remains', () => {
    const empty: ItemSetMetrics = { totalItems: 1, completedItems: 0, completionPercent: 0, remainingDurationMs: 0 };
    expect(formatViewMetricsSummary(empty, 'ru')).toBeNull();
    expect(formatViewMetricsSummary({ ...empty, remainingDurationMs: 35 * minute }, 'ru')?.text).toBe('35мин');
    expect(formatViewMetricsSummary({ ...empty, completedItems: 1, completionPercent: 100 }, 'ru')?.text).toBe('100%');
  });

  it('renders a compact visible result and a full accessible description', () => {
    const metrics: ItemSetMetrics = { totalItems: 20, completedItems: 7, completionPercent: 35, remainingDurationMs: 2 * hour + 15 * minute };
    const markup = renderToStaticMarkup(<ViewMetricsSummary metrics={metrics} language="ru" />);
    expect(markup).toContain('class="view-metrics-summary"');
    expect(markup).toContain('35% · 2ч 15мин');
    expect(markup).toContain('aria-label="Выполнено 35 процентов. Осталось');
  });
});
