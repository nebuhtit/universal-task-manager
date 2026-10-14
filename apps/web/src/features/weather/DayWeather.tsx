import type { ReactNode } from 'react';
import { dayTemperatureRange, dayWeatherKind, type DayWeatherKind } from './dayWeatherModel';
import { usableForecast, useWeather } from './weatherService';

export function DayWeather({ dateKey, zone, ru }: { dateKey: string; zone: string; ru: boolean }) {
  const state = useWeather();
  const forecast = usableForecast(state);
  const kind = dayWeatherKind(forecast, dateKey, zone);
  const temperature = dayTemperatureRange(forecast, dateKey, zone);
  const cloud = <path d="M6 16a4 4 0 1 1 1-7.9A5 5 0 0 1 17 10a3 3 0 1 1 1 6Z" />;
  const sun = <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>;
  const icons: Record<DayWeatherKind, ReactNode> = {
    sun,
    partly: <><circle cx="15" cy="8" r="3" /><path d="M15 1v2m0 10v1m7-6h-2m-9-5-1.5-1.5m11 11L19 11" />{cloud}</>,
    cloud,
    fog: <>{cloud}<path d="M4 19h16M7 22h10" /></>,
    rain: <>{cloud}<path d="m8 19-1 3m6-3-1 3m6-3-1 3" /></>,
    snow: <>{cloud}<path d="M8 19v3m-1.5-2.3 3 1.6m0-1.6-3 1.6M17 19v3m-1.5-2.3 3 1.6m0-1.6-3 1.6" /></>,
    storm: <>{cloud}<path d="m13 16-3 4h4l-2 3" /></>,
    unknown: <>{cloud}<path d="M10.1 11a2 2 0 1 1 3 1.7c-1 .5-1 1-1 2M12.1 17h.01" /></>,
  };
  const names: Record<DayWeatherKind, string> = ru
    ? { sun: 'ясно', partly: 'переменная облачность', cloud: 'облачно', fog: 'туман', rain: 'дождь', snow: 'снег', storm: 'гроза', unknown: 'нет данных' }
    : { sun: 'clear', partly: 'partly cloudy', cloud: 'cloudy', fog: 'fog', rain: 'rain', snow: 'snow', storm: 'thunderstorm', unknown: 'unavailable' };
  const label = `${ru ? 'Погода на день' : 'Day forecast'}: ${names[kind]}`;
  const title = `${label}${state.settings.location ? ` · ${state.settings.location.name}` : ru ? ' · Укажите город в настройках погоды' : ' · Select a city in Weather settings'}`;
  return <span className="calendar-day-weather-group" data-testid="calendar-day-weather-group"><svg className="calendar-day-weather" data-testid="calendar-day-weather" data-weather={kind} viewBox="0 0 24 24" role="img" aria-label={label} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><title>{title}</title>{icons[kind]}</svg>{temperature && <span className="calendar-day-temperature" data-testid="calendar-day-temperature" aria-label={`${ru ? 'Температура' : 'Temperature'}: ${temperature.min}° · ${temperature.max}°`}>{temperature.min}° · {temperature.max}°</span>}</span>;
}
