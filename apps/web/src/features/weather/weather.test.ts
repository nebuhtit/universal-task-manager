import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWeatherService, parseForecast, usableForecast, validLocation, WEATHER_KEY } from './weatherService';
import { solarDay, solarGradient } from './solar';
import { buildSegments, dayBounds } from '../calendar/timelineLayout';
const location = { name: 'Berlin', latitude: 52.52, longitude: 13.405 };
const hour = 3_600_000;
let storage: Map<string, string>;
let documentMock: EventTarget & { visibilityState: string };
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  documentMock = Object.assign(new EventTarget(), { visibilityState: 'visible' }); vi.stubGlobal('document', documentMock);
});
afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
const payload = { hourly: { time: [Date.parse('2026-09-23T13:00:00Z') / 1000], precipitation_probability: [50] } };
const response = () => Promise.resolve({ ok: true, json: async () => payload });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
describe('weather service', () => {
  it('starts disabled, persists settings, refreshes once per hour, stops immediately and restores on next start', async () => {
    const fetcher = vi.fn(response); vi.stubGlobal('fetch', fetcher);
    const service = createWeatherService(); stop = service.start(); expect(fetcher).not.toHaveBeenCalled();
    service.configure({ enabled: true, location }); await settle(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(WEATHER_KEY)!)).toMatchObject({ enabled: true, location });
    await vi.advanceTimersByTimeAsync(hour); expect(fetcher).toHaveBeenCalledTimes(2);
    service.configure({ enabled: false }); await vi.advanceTimersByTimeAsync(hour * 2); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().settings.location).toEqual(location);
    stop(); const next = createWeatherService(); stop = next.start(); expect(next.getSnapshot().settings.enabled).toBe(false); expect(next.getSnapshot().settings.location).toEqual(location);
  });
  it('cancels pending requests and ignores late answers after location changes or disabling precipitation', async () => {
    const pending: { resolve: (v: unknown) => void; signal: AbortSignal }[] = [];
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal }))));
    const service = createWeatherService(); stop = service.start(); service.configure({ enabled: true, location });
    void service.refresh(); expect(pending).toHaveLength(1);
    service.configure({ location: { ...location, latitude: 40 } }); expect(pending[0]!.signal.aborted).toBe(true);
    pending[0]!.resolve({ ok: true, json: async () => payload }); await settle(); expect(service.getSnapshot().forecast).toBeUndefined();
    service.configure({ precipitation: false }); expect(pending[1]!.signal.aborted).toBe(true);
    pending[1]!.resolve({ ok: true, json: async () => payload }); await settle(); expect(service.getSnapshot().forecast).toBeUndefined();
    await vi.advanceTimersByTimeAsync(hour * 2); expect(pending).toHaveLength(2);
  });
  it('refreshes on foreground only when due and expires cached data offline at six hours', async () => {
    const fetcher = vi.fn(response); vi.stubGlobal('fetch', fetcher);
    const service = createWeatherService(); stop = service.start(); service.configure({ enabled: true, location }); await settle();
    expect(usableForecast(service.getSnapshot())).toHaveLength(1);
    documentMock.dispatchEvent(new Event('visibilitychange')); expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValue(new Error('offline'));
    vi.setSystemTime(Date.now() + hour); documentMock.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(service.getSnapshot().error).toBe('network'); expect(usableForecast(service.getSnapshot())).toHaveLength(1);
    vi.setSystemTime(Date.now() + 5 * hour); documentMock.dispatchEvent(new Event('visibilitychange')); await settle(); expect(usableForecast(service.getSnapshot())).toEqual([]);
    stop(); const next = createWeatherService(); stop = next.start(); await settle(); expect(usableForecast(next.getSnapshot())).toEqual([]);
  });
  it('loads a fresh offline cache on startup and clears a service failure after recovery', async () => {
    const fetcher = vi.fn(response); vi.stubGlobal('fetch', fetcher);
    const first = createWeatherService(); stop = first.start(); first.configure({ enabled: true, location }); await settle(); stop();
    fetcher.mockRejectedValue(new Error('offline'));
    const second = createWeatherService(); stop = second.start(); await settle();
    expect(second.getSnapshot().error).toBe('network'); expect(usableForecast(second.getSnapshot())).toHaveLength(1);
    fetcher.mockImplementation(response); await second.refresh(); expect(second.getSnapshot().error).toBeUndefined();
    second.configure({ location: { ...location, longitude: 20 } });
    expect(usableForecast(second.getSnapshot())).toEqual([]); await settle();
    expect(usableForecast(second.getSnapshot())).toHaveLength(1);
  });
  it('handles broken storage and request timeout without throwing', async () => {
    storage.set(WEATHER_KEY, '{'); const service = createWeatherService(); stop = service.start(); expect(service.getSnapshot().storageError).toBe('storage');
    vi.stubGlobal('fetch', (_url: string, options: {signal: AbortSignal}) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')))));
    service.configure({ enabled: true, location }); await vi.advanceTimersByTimeAsync(15_000); expect(service.getSnapshot().error).toBe('timeout'); expect(service.getSnapshot().busy).toBe(false);
  });
  it('validates coordinates and preceding-hour probabilities without converting missing values to zero', () => {
    expect(validLocation(location)).toBe(true); expect(validLocation({ ...location, latitude: 91 })).toBe(false);
    const hours = parseForecast({ hourly: { time: [3600, 7200, 10800, 14400], precipitation_probability: [0, 50, 100, null] } });
    expect(hours.map(v => v.probability)).toEqual([0, 50, 100, null]); expect(hours[0]).toEqual({ start: 0, end: hour, probability: 0 });
    expect(() => parseForecast({ hourly: { time: [3600], precipitation_probability: [101] } })).toThrow();
  });
});
describe('solar timeline', () => {
  it('places Berlin equinox sunrise and sunset in the expected civil day with plausible reference times', () => {
    const { day, events } = solarDay('2026-09-23', 'Europe/Berlin', location);
    expect(events).toHaveLength(8); expect(events.every(e => e.at >= day.start && e.at < day.end)).toBe(true);
    const sunrise = events.find(e => e.kind === 'sunrise')!;
    expect(Math.abs(sunrise.at - Date.parse('2026-09-23T04:55:00Z'))).toBeLessThan(15 * 60_000);
    expect(events.find(e => e.kind === 'sunset')!.at).toBeGreaterThan(sunrise.at + 11 * hour);
  });
  it.each([['2026-03-29', 23], ['2026-10-25', 25]] as const)('handles DST %s and hidden sleep without stretching', (date, hours) => {
    const result = solarDay(date, 'Europe/Berlin', location); expect(result.day.end - result.day.start).toBe(hours * hour);
    const segments = buildSegments(result.day, [{ start: result.day.start, end: result.day.start + 6 * hour }]);
    expect(segments[0]!.height).toBe(36); const gradient = solarGradient(segments[1]!, location, result.events); expect(gradient).not.toContain('NaN'); expect(gradient).toContain('100%');
  });
  it.each(['2025-09-23', '2028-09-23', '2026-06-21', '2026-12-21'])('supports past/future and polar conditions on %s', date => {
    const pole = { name: 'Pole', latitude: 89, longitude: 0 };
    const result = solarDay(date, 'Pacific/Auckland', pole);
    expect(result.events.every(e => Number.isFinite(e.at))).toBe(true);
    const gradient = solarGradient(buildSegments(result.day, [])[0]!, pole, result.events); expect(gradient).not.toMatch(/NaN|undefined/);
    if (date.endsWith('06-21') || date.endsWith('12-21')) expect(result.events.filter(e => e.kind === 'sunrise' || e.kind === 'sunset')).toEqual([]);
  });
  it('filters events to the selected timezone even when it differs from geographic timezone', () => {
    const { events } = solarDay('2026-09-23', 'Pacific/Honolulu', location), bounds = dayBounds('2026-09-23', 'Pacific/Honolulu');
    expect(events.length).toBeGreaterThan(0); expect(events.every(e => e.at >= bounds.start && e.at < bounds.end)).toBe(true);
  });
});
