import { useSyncExternalStore } from 'react';

export type WeatherLocation = { name: string; latitude: number; longitude: number };
export type WeatherSettings = { enabled: boolean; solar: boolean; precipitation: boolean; location?: WeatherLocation };
export type WeatherHour = { start: number; end: number; probability: number | null; cloudCover?: number | null; precipitationMm?: number | null };
export type WeatherForecast = { locationKey: string; fetchedAt: number; hours: WeatherHour[] };
export type WeatherState = { settings: WeatherSettings; forecast?: WeatherForecast | undefined; lastAttempt?: number | undefined; error?: string | undefined; storageError?: string | undefined; busy: boolean; now: number };
export const WEATHER_KEY = 'utm:weather:v1';
const CACHE_KEY = 'utm:weather-cache:v1';
const HOUR = 3_600_000;
export const locationKey = (location: WeatherLocation) => `${location.latitude},${location.longitude}`;
export function validLocation(value: unknown): value is WeatherLocation {
  const v = value as WeatherLocation | null;
  return !!v && typeof v.name === 'string' && !!v.name.trim() && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90 && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180;
}
export function parseForecast(value: unknown): WeatherHour[] {
  const hourly = (value as { hourly?: { time?: unknown[]; precipitation_probability?: unknown[]; cloud_cover?: unknown[]; precipitation?: unknown[] } })?.hourly;
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly.precipitation_probability) || !hourly.time.length || hourly.time.length !== hourly.precipitation_probability.length) throw new Error('invalid-response');
  if (hourly.cloud_cover && hourly.cloud_cover.length !== hourly.time.length || hourly.precipitation && hourly.precipitation.length !== hourly.time.length) throw new Error('invalid-response');
  let previous = -Infinity;
  return hourly.time.map((time, i) => {
    if (typeof time !== 'number' || !Number.isFinite(time) || time <= previous) throw new Error('invalid-response');
    previous = time;
    const p = hourly.precipitation_probability![i];
    if (p !== null && (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100)) throw new Error('invalid-response');
    const cloud = hourly.cloud_cover?.[i], rain = hourly.precipitation?.[i];
    if (cloud !== undefined && cloud !== null && (typeof cloud !== 'number' || !Number.isFinite(cloud) || cloud < 0 || cloud > 100)) throw new Error('invalid-response');
    if (rain !== undefined && rain !== null && (typeof rain !== 'number' || !Number.isFinite(rain) || rain < 0)) throw new Error('invalid-response');
    // Open-Meteo probability describes the preceding hour, not the following one.
    return { start: time * 1000 - HOUR, end: time * 1000, probability: p as number | null, ...(cloud !== undefined ? { cloudCover: cloud as number | null } : {}), ...(rain !== undefined ? { precipitationMm: rain as number | null } : {}) };
  });
}
export function usableForecast(state: WeatherState): WeatherHour[] {
  const { settings, forecast, now } = state;
  return settings.enabled && (settings.solar || settings.precipitation) && settings.location && forecast?.locationKey === locationKey(settings.location) && now >= forecast.fetchedAt && now - forecast.fetchedAt < 6 * HOUR ? forecast.hours : [];
}

export function createWeatherService() {
  let state: WeatherState = { settings: { enabled: false, solar: true, precipitation: true }, busy: false, now: Date.now() };
  const listeners = new Set<() => void>();
  let active = false, loaded = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let generation = 0;
  const emit = (patch: Partial<WeatherState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const save = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); emit({ storageError: undefined }); }
    catch { emit({ storageError: 'storage' }); }
  };
  const load = () => {
    if (loaded) return; loaded = true;
    try {
      const raw = localStorage.getItem(WEATHER_KEY);
      if (raw) {
        const v = JSON.parse(raw) as WeatherSettings;
        if (typeof v.enabled !== 'boolean' || typeof v.solar !== 'boolean' || typeof v.precipitation !== 'boolean' || (v.location !== undefined && !validLocation(v.location))) throw new Error();
        state = { ...state, settings: v };
      }
      const cache = localStorage.getItem(CACHE_KEY);
      if (cache) {
        const v = JSON.parse(cache) as WeatherForecast;
        if (typeof v.locationKey !== 'string' || !Number.isFinite(v.fetchedAt) || !Array.isArray(v.hours) || !v.hours.every(h => Number.isFinite(h.start) && h.end === h.start + HOUR && (h.probability === null || (Number.isFinite(h.probability) && h.probability >= 0 && h.probability <= 100)))) throw new Error();
        state = { ...state, forecast: v };
      }
    } catch { state = { ...state, storageError: 'storage' }; }
  };
  const cancel = () => { generation++; request?.abort(); request = undefined; if (timer) clearTimeout(timer); timer = undefined; };
  const eligible = () => active && state.settings.enabled && (state.settings.solar || state.settings.precipitation) && !!state.settings.location;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (!eligible()) return;
    const retryAt = (state.lastAttempt ?? Date.now()) + HOUR;
    const expiresAt = (state.forecast?.fetchedAt ?? 0) + 6 * HOUR;
    const next = Math.min(retryAt, expiresAt > Date.now() ? expiresAt : Infinity);
    timer = setTimeout(() => { emit({ now: Date.now() }); if (Date.now() >= retryAt) void refresh(); else schedule(); }, Math.max(1, next - Date.now()));
  };
  const refresh = async () => {
    if (!eligible() || request) return;
    const location = state.settings.location!;
    const controller = new AbortController(); request = controller;
    const id = generation;
    emit({ busy: true, lastAttempt: Date.now(), now: Date.now() });
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const query = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), hourly: 'precipitation_probability,cloud_cover,precipitation', forecast_days: '16', timeformat: 'unixtime', timezone: 'GMT' });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`http-${response.status}`);
      const hours = parseForecast(await response.json());
      if (id !== generation) return;
      const forecast = { locationKey: locationKey(location), fetchedAt: Date.now(), hours };
      emit({ forecast, error: undefined }); save(CACHE_KEY, forecast);
    } catch (reason) {
      if (id === generation) emit({ error: controller.signal.aborted ? 'timeout' : reason instanceof Error && /^(http-\d+|invalid-response)$/.test(reason.message) ? reason.message : 'network' });
    } finally {
      clearTimeout(timeout);
      if (id === generation) { request = undefined; emit({ busy: false, now: Date.now() }); schedule(); }
    }
  };
  const foreground = () => {
    if (document.visibilityState !== 'visible') return;
    emit({ now: Date.now() });
    if (Date.now() - (state.lastAttempt ?? 0) >= HOUR) void refresh();
    schedule();
  };
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    start() {
      load(); active = true; emit({ now: Date.now() });
      document.addEventListener('visibilitychange', foreground);
      void refresh();
      return () => { active = false; cancel(); document.removeEventListener('visibilitychange', foreground); emit({ busy: false }); };
    },
    configure(patch: Partial<WeatherSettings>) {
      const settings = { ...state.settings, ...patch };
      if (settings.location && !validLocation(settings.location)) return;
      const changed = settings.enabled !== state.settings.enabled || settings.solar !== state.settings.solar || settings.precipitation !== state.settings.precipitation || JSON.stringify(settings.location) !== JSON.stringify(state.settings.location);
      if (changed) cancel();
      emit({ settings, ...(changed ? { busy: false, error: undefined, lastAttempt: undefined } : {}) });
      save(WEATHER_KEY, settings);
      if (changed) void refresh();
    },
    refresh,
  };
}
export const weatherService = createWeatherService();
export const useWeather = () => useSyncExternalStore(weatherService.subscribe, weatherService.getSnapshot, weatherService.getSnapshot);
