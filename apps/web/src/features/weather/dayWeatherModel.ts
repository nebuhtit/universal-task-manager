import { dayBounds } from '../calendar/timelineLayout';
import type { WeatherHour } from './weatherService';

export type DayWeatherKind = 'sun' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm' | 'unknown';
const severity: DayWeatherKind[] = ['sun', 'partly', 'cloud', 'fog', 'rain', 'snow', 'storm'];
export function dayWeatherKind(hours: WeatherHour[], dateKey: string, zone: string): DayWeatherKind {
  const day = dayBounds(dateKey, zone);
  let result: DayWeatherKind = 'unknown';
  for (const hour of hours) {
    if (hour.start >= day.end || hour.end <= day.start) continue;
    const code = hour.weatherCode;
    const kind: DayWeatherKind = code === 0 ? 'sun' : code === 1 || code === 2 ? 'partly' : code === 3 ? 'cloud'
      : code === 45 || code === 48 ? 'fog' : [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code ?? -1) ? 'rain'
        : [71, 73, 75, 77, 85, 86].includes(code ?? -1) ? 'snow' : [95, 96, 99].includes(code ?? -1) ? 'storm' : 'unknown';
    if (severity.indexOf(kind) > severity.indexOf(result)) result = kind;
  }
  return result;
}

export function dayTemperatureRange(hours: WeatherHour[], dateKey: string, zone: string): { min: number; max: number } | undefined {
  const day = dayBounds(dateKey, zone);
  const values = hours
    .filter((hour) => hour.start < day.end && hour.end > day.start && typeof hour.temperatureC === 'number' && Number.isFinite(hour.temperatureC))
    .map((hour) => hour.temperatureC!);
  if (!values.length) return undefined;
  return { min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)) };
}
