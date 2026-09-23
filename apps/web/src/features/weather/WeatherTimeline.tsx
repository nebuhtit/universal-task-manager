import { useMemo } from 'react';
import { positionAt, type Segment } from '../calendar/timelineLayout';
import { solarDay, solarGradient, solarNames } from './solar';
import { useWeather, usableForecast } from './weatherService';
import './weather.css';

export function WeatherTimeline({ dateKey, zone, ru, segments }: { dateKey: string; zone: string; ru: boolean; segments: Segment[] }) {
  const state = useWeather();
  const { settings } = state;
  const location = settings.location;
  const forecast = usableForecast(state);
  const solar = useMemo(() => settings.enabled && settings.solar && location ? solarDay(dateKey, zone, location) : undefined, [settings.enabled, settings.solar, location, dateKey, zone]);
  const backgrounds = useMemo(() => solar && location ? segments.filter(s => !s.hidden).map(s => ({ segment: s, gradient: solarGradient(s, location, solar.events, forecast) })) : [], [solar, location, segments, forecast]);
  if (!settings.enabled || !location || (!settings.solar && !settings.precipitation)) return null;
  const time = (at: number) => new Intl.DateTimeFormat(ru ? 'ru' : 'en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return <div className="weather-background" data-testid="weather-background" aria-hidden="true">
    {backgrounds.map(({segment: s, gradient}) => <div className="weather-solar" key={s.start} style={{ top: s.top, height: s.height, background: gradient }} />)}
    {settings.precipitation && forecast.flatMap(hour => hour.probability === null || hour.probability === 0 ? [] : segments.filter(s => !s.hidden && s.start < hour.end && s.end > hour.start).map(s => {
      const start = Math.max(hour.start, s.start), end = Math.min(hour.end, s.end);
      return <div key={`${hour.start}-${s.start}`} className="weather-haze-slot" data-testid="weather-haze" style={{ top: positionAt(start, segments), height: (end - start) / 60_000 }}><span className="weather-haze" style={{ opacity: Math.max(0.35, hour.probability! / 100) }} />{hour.probability! >= 20 && end - start >= 30 * 60_000 && <span className="weather-haze-label"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 10a8 8 0 0 1 16 0c-2-1.4-3.3-1.4-5.3 0-2-1.4-3.4-1.4-5.4 0C5.3 8.6 4 8.6 2 10Z"/><path d="M10 10v6a2 2 0 0 0 4 0"/></svg>{hour.probability}%</span>}</div>;
    }))}
    {solar?.events.filter(e => (e.kind === 'sunrise' || e.kind === 'sunset') && !segments.some(s => s.hidden && e.at >= s.start && e.at < s.end)).map(e => <div key={`${e.kind}-${e.at}`} className="weather-solar-marker" style={{ top: positionAt(e.at, segments) }}><span>{solarNames[e.kind][ru ? 0 : 1]} {time(e.at)}</span></div>)}
  </div>;
}
