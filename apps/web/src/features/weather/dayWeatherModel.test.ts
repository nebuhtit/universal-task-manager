import { describe, expect, it } from 'vitest';
import { dayTemperatureRange, dayWeatherKind } from './dayWeatherModel';
import { parseForecast } from './weatherService';
import type { WeatherHour } from './weatherService';

const hour = (at: string, weatherCode?: number): WeatherHour => ({ start: Date.parse(at), end: Date.parse(at) + 3_600_000, probability: null, ...(weatherCode !== undefined ? { weatherCode } : {}) });
describe('day weather icon', () => {
  it.each([[0, 'sun'], [2, 'partly'], [3, 'cloud'], [48, 'fog'], [63, 'rain'], [85, 'snow'], [95, 'storm']] as const)('maps WMO %s to %s', (code, expected) => {
    expect(dayWeatherKind([hour('2026-10-14T09:00:00Z', code)], '2026-10-14', 'Europe/Moscow')).toBe(expected);
  });
  it('selects significant weather across the selected local day, not the current hour', () => {
    const hours = [hour('2026-10-13T21:00:00Z', 63), hour('2026-10-14T12:00:00Z', 0), hour('2026-10-14T21:00:00Z', 95)];
    expect(dayWeatherKind(hours, '2026-10-14', 'Europe/Moscow')).toBe('rain');
    expect(dayWeatherKind(hours, '2026-10-15', 'Europe/Moscow')).toBe('storm');
  });
  it('shows the rounded temperature range for the selected local day only', () => {
    const hours: WeatherHour[] = [
      { ...hour('2026-10-13T20:00:00Z'), temperatureC: -8 },
      { ...hour('2026-10-13T21:00:00Z'), temperatureC: -2.4 },
      { ...hour('2026-10-14T12:00:00Z'), temperatureC: 7.6 },
      { ...hour('2026-10-14T21:00:00Z'), temperatureC: 12 },
    ];
    expect(dayTemperatureRange(hours, '2026-10-14', 'Europe/Moscow')).toEqual({ min: -2, max: 8 });
    expect(dayTemperatureRange([], '2026-10-14', 'UTC')).toBeUndefined();
  });
  it('does not invent conditions for unavailable dates or old caches', () => {
    expect(dayWeatherKind([], '2026-10-14', 'UTC')).toBe('unknown');
    expect(dayWeatherKind([hour('2026-10-14T09:00:00Z')], '2026-10-14', 'UTC')).toBe('unknown');
    expect(dayWeatherKind([hour('2026-10-14T09:00:00Z', 0)], '2026-11-14', 'UTC')).toBe('unknown');
  });
  it('reads optional weather codes while retaining compatibility with existing forecasts', () => {
    expect(parseForecast({ hourly: { time: [3600], precipitation_probability: [null], weather_code: [75] } })[0]?.weatherCode).toBe(75);
    expect(() => parseForecast({ hourly: { time: [3600], precipitation_probability: [null], weather_code: [100] } })).toThrow('invalid-response');
    expect(() => parseForecast({ hourly: { time: [3600], precipitation_probability: [null], weather_code: [] } })).toThrow('invalid-response');
    expect(parseForecast({ hourly: { time: [3600], precipitation_probability: [null], temperature_2m: [-3.5] } })[0]?.temperatureC).toBe(-3.5);
    expect(() => parseForecast({ hourly: { time: [3600], precipitation_probability: [null], temperature_2m: [null, 2] } })).toThrow('invalid-response');
    expect(() => parseForecast({ hourly: { time: [3600], precipitation_probability: [null], temperature_2m: ['cold'] } })).toThrow('invalid-response');
  });
});
