import SunCalc from 'suncalc';
import { dayBounds, type Segment } from '../calendar/timelineLayout';
import type { WeatherHour, WeatherLocation } from './weatherService';
export const solarNames = {
  nightEnd: ['Астрономический рассвет', 'Astronomical dawn'], nauticalDawn: ['Навигационный рассвет', 'Nautical dawn'],
  dawn: ['Гражданский рассвет', 'Civil dawn'], sunrise: ['Восход', 'Sunrise'],
  sunset: ['Закат', 'Sunset'], dusk: ['Конец гражданских сумерек', 'Civil dusk'],
  nauticalDusk: ['Конец навигационных сумерек', 'Nautical dusk'], night: ['Конец астрономических сумерек', 'Astronomical dusk'],
} as const;
export type SolarEvent = { kind: keyof typeof solarNames; at: number };
export function solarDay(dateKey: string, zone: string, location: WeatherLocation) {
  const day = dayBounds(dateKey, zone);
  const events: SolarEvent[] = [];
  // Solar days and civil days need not coincide. Gather adjacent solar cycles,
  // then filter absolute instants using the existing zoned calendar boundaries.
  for (let offset = -2; offset <= 2; offset++) {
    const times = SunCalc.getTimes(new Date((day.start + day.end) / 2 + offset * 86_400_000), location.latitude, location.longitude);
    for (const kind of Object.keys(solarNames) as SolarEvent['kind'][]) {
      const at = times[kind]?.getTime();
      if (Number.isFinite(at) && at >= day.start && at < day.end && !events.some(e => e.kind === kind && Math.abs(e.at - at) < 1000)) events.push({ kind, at });
    }
  }
  return { day, events: events.sort((a, b) => a.at - b.at) };
}
export function solarColor(at: number, location: WeatherLocation) {
  const altitude = SunCalc.getPosition(new Date(at), location.latitude, location.longitude).altitude * 180 / Math.PI;
  const stops = [
    { altitude: -20, color: 'night' }, { altitude: -15, color: 'astronomical' },
    { altitude: -9, color: 'nautical' }, { altitude: -3, color: 'civil' },
    { altitude: 3, color: 'horizon' }, { altitude: 12, color: 'day' }, { altitude: 35, color: 'zenith' },
  ];
  const upper = stops.findIndex(stop => altitude < stop.altitude);
  if (upper <= 0) return `var(--color-solar-${upper === 0 ? 'night' : 'zenith'})`;
  const before = stops[upper - 1]!, after = stops[upper]!;
  const blend = Math.round((altitude - before.altitude) / (after.altitude - before.altitude) * 100);
  return `color-mix(in srgb, var(--color-solar-${before.color}) ${100 - blend}%, var(--color-solar-${after.color}))`;
}
export function solarGradient(segment: Segment, location: WeatherLocation, events: SolarEvent[], hours: WeatherHour[] = []) {
  const points = [segment.start, segment.end, ...events.filter(e => e.at > segment.start && e.at < segment.end).map(e => e.at)];
  for (let at = segment.start + 10 * 60_000; at < segment.end; at += 10 * 60_000) points.push(at);
  const weatherColor = (at: number) => {
    const altitude = SunCalc.getPosition(new Date(at), location.latitude, location.longitude).altitude * 180 / Math.PI;
    if (altitude < -3) return solarColor(at, location);
    const current = hours.find(h => at >= h.start && at < h.end) ?? hours.find(h => h.start > at);
    if (!current) return solarColor(at, location);
    const next = hours.find(h => h.start >= current.end);
    const blend = Math.max(0, Math.min(1, (at - current.start) / (current.end - current.start)));
    const cloud = (current.cloudCover ?? 50) * (1 - blend) + (next?.cloudCover ?? current.cloudCover ?? 50) * blend;
    const rain = (current.precipitationMm ?? 0) * (1 - blend) + (next?.precipitationMm ?? current.precipitationMm ?? 0) * blend;
    const cloudMix = Math.round(Math.min(85, cloud * 0.85));
    const rainMix = Math.round(Math.min(65, rain * 22));
    const zenithMix = Math.round(Math.max(0, Math.min(100, (altitude - 15) * 5)));
    const cloudColor = `color-mix(in srgb, var(--color-weather-cloud) ${100 - zenithMix}%, var(--color-weather-cloud-zenith))`;
    const base = `color-mix(in srgb, ${solarColor(at, location)} ${100 - cloudMix}%, ${cloudColor})`;
    return rainMix ? `color-mix(in srgb, ${base} ${100 - rainMix}%, var(--color-weather-rain))` : base;
  };
  return `linear-gradient(to bottom, ${[...new Set(points)].sort((a,b) => a-b).map(at => `${weatherColor(at)} ${(at - segment.start) / (segment.end - segment.start) * 100}%`).join(', ')})`;
}
