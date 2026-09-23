import SunCalc from 'suncalc';
import { dayBounds, type Segment } from '../calendar/timelineLayout';
import type { WeatherLocation } from './weatherService';
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
  return `var(--color-solar-${altitude < -18 ? 'night' : altitude < -12 ? 'astronomical' : altitude < -6 ? 'nautical' : altitude < -0.833 ? 'civil' : altitude < 6 ? 'horizon' : 'day'})`;
}
export function solarGradient(segment: Segment, location: WeatherLocation, events: SolarEvent[]) {
  const points = [segment.start, segment.end, ...events.filter(e => e.at > segment.start && e.at < segment.end).map(e => e.at)];
  for (let at = segment.start + 10 * 60_000; at < segment.end; at += 10 * 60_000) points.push(at);
  return `linear-gradient(to bottom, ${[...new Set(points)].sort((a,b) => a-b).map(at => `${solarColor(at, location)} ${(at - segment.start) / (segment.end - segment.start) * 100}%`).join(', ')})`;
}
