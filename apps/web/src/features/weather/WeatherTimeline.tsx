import { useMemo } from 'react';
import { positionAt, type Segment } from '../calendar/timelineLayout';
import { solarDay, solarGradient, solarNames } from './solar';
import { useWeather, usableForecast } from './weatherService';
import './weather.css';

export function WeatherTimeline({ dateKey, zone, ru, segments, legend = false }: { dateKey: string; zone: string; ru: boolean; segments: Segment[]; legend?: boolean }) {
  const state = useWeather();
  const { settings } = state;
  const location = settings.location;
  const solar = useMemo(() => settings.enabled && settings.solar && location ? solarDay(dateKey, zone, location) : undefined, [settings.enabled, settings.solar, location, dateKey, zone]);
  const backgrounds = useMemo(() => solar && location ? segments.filter(s => !s.hidden).map(s => ({ segment: s, gradient: solarGradient(s, location, solar.events) })) : [], [solar, location, segments]);
  if (!settings.enabled || !location || (!settings.solar && !settings.precipitation)) return null;
  const time = (at: number) => new Intl.DateTimeFormat(ru ? 'ru' : 'en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  if (legend) return <details className="weather-legend"><summary>{location.name} · {ru ? 'Солнце и осадки' : 'Sun and precipitation'}</summary>
    <p>{zone}</p>
    {solar && (solar.events.length ? <ul>{solar.events.map(e => <li key={`${e.kind}-${e.at}`}>{solarNames[e.kind][ru ? 0 : 1]}: {time(e.at)}</li>)}</ul> : <p>{ru ? 'В эти сутки нет переходов восхода, заката или сумерек.' : 'No sunrise, sunset or twilight transitions on this day.'}</p>)}
    <p>{ru ? 'Плотность дымки — вероятность осадков, не их интенсивность. Без прогноза дымка не отображается.' : 'Haze density represents precipitation probability, not intensity. No haze is drawn without a forecast.'}</p>
    <small>{ru ? 'Расчёт солнца' : 'Solar calculation'}: <a href="https://github.com/mourner/suncalc" target="_blank" rel="noreferrer">SunCalc</a> · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></small>
  </details>;
  return <div className="weather-background" data-testid="weather-background" aria-hidden="true">
    {backgrounds.map(({segment: s, gradient}) => <div className="weather-solar" key={s.start} style={{ top: s.top, height: s.height, background: gradient }} />)}
    {usableForecast(state).flatMap(hour => hour.probability === null || hour.probability === 0 ? [] : segments.filter(s => !s.hidden && s.start < hour.end && s.end > hour.start).map(s => {
      const start = Math.max(hour.start, s.start), end = Math.min(hour.end, s.end);
      return <div key={`${hour.start}-${s.start}`} className="weather-haze" data-testid="weather-haze" style={{ top: positionAt(start, segments), height: (end - start) / 60_000, opacity: hour.probability! / 100 }} />;
    }))}
    {solar?.events.filter(e => (e.kind === 'sunrise' || e.kind === 'sunset') && !segments.some(s => s.hidden && e.at >= s.start && e.at < s.end)).map(e => <div key={`${e.kind}-${e.at}`} className="weather-solar-marker" style={{ top: positionAt(e.at, segments) }}><span>{solarNames[e.kind][ru ? 0 : 1]} {time(e.at)}</span></div>)}
  </div>;
}
