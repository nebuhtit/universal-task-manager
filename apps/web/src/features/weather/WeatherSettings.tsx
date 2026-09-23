import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Input } from '../../components/ui/primitives';
import { useWeather, validLocation, weatherService, type WeatherLocation } from './weatherService';
import './weather.css';

export function WeatherSettings({ ru, zone }: { ru: boolean; zone: string }) {
  const state = useWeather(), { settings } = state;
  const [query, setQuery] = useState('');
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState('');
  const [results, setResults] = useState<WeatherLocation[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => { setLatitude(String(settings.location?.latitude ?? '')); setLongitude(String(settings.location?.longitude ?? '')); if (settings.location) setQuery(settings.location.name); }, [settings.location]);
  useEffect(() => {
    if (!settings.enabled) { generation.current++; controller.current?.abort(); setBusy(false); setResults([]); }
    return () => { generation.current++; controller.current?.abort(); };
  }, [settings.enabled]);
  const choose = (location: WeatherLocation) => { generation.current++; controller.current?.abort(); setBusy(false); weatherService.configure({ location }); setQuery(location.name); setResults([]); setError(''); };
  const search = async () => {
    if (query.trim().length < 2) { setError(ru ? 'Введите хотя бы два символа.' : 'Enter at least two characters.'); return; }
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    const id = ++generation.current; setBusy(true); setError(''); setResults([]);
    const timeout = setTimeout(() => request.abort(), 15_000);
    try {
      const params = new URLSearchParams({ name: query.trim(), count: '8', language: ru ? 'ru' : 'en', format: 'json' });
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal: request.signal });
      if (!response.ok) throw new Error();
      const data = await response.json() as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
      const places = (data.results ?? []).map(v => ({ name: [v.name, v.admin1, v.country].filter(Boolean).join(', '), latitude: v.latitude, longitude: v.longitude })).filter(validLocation);
      if (id !== generation.current) return;
      if (places.length === 1) choose(places[0]!);
      else { setResults(places); if (!places.length) setError(ru ? 'Город не найден. Можно указать координаты.' : 'No city found. You can enter coordinates.'); }
    } catch { if (id === generation.current) setError(ru ? 'Не удалось найти город. Проверьте соединение и повторите.' : 'City search failed. Check your connection and retry.'); }
    finally { clearTimeout(timeout); if (id === generation.current) setBusy(false); }
  };
  const geolocate = () => {
    if (!navigator.geolocation) { setError(ru ? 'Геолокация недоступна.' : 'Geolocation unavailable.'); return; }
    controller.current?.abort(); const id = ++generation.current; setBusy(true); setError('');
    navigator.geolocation.getCurrentPosition(position => {
      if (id !== generation.current) return;
      choose({ name: ru ? 'Выбранное местоположение' : 'Selected location', latitude: position.coords.latitude, longitude: position.coords.longitude });
    }, () => { if (id === generation.current) { setBusy(false); setError(ru ? 'Не удалось определить место: разрешите геолокацию или выберите город вручную.' : 'Location unavailable: allow geolocation or choose a city manually.'); } }, { timeout: 15_000, maximumAge: 300_000, enableHighAccuracy: false });
  };
  const saveCoordinates = () => {
    const location = { name: `${latitude}, ${longitude}`, latitude: Number(latitude), longitude: Number(longitude) };
    if (!latitude.trim() || !longitude.trim() || !validLocation(location)) { setError(ru ? 'Широта: от −90 до 90; долгота: от −180 до 180.' : 'Latitude: −90 to 90; longitude: −180 to 180.'); return; }
    choose(location);
  };
  const date = (at?: number) => at ? new Intl.DateTimeFormat(ru ? 'ru' : 'en-GB', { timeZone: zone, dateStyle: 'short', timeStyle: 'short' }).format(at) : '—';
  const errorText = state.error === 'timeout' ? (ru ? 'Превышено время ожидания.' : 'Request timed out.') : state.error === 'invalid-response' ? (ru ? 'Некорректный ответ прогноза.' : 'Invalid forecast response.') : state.error?.startsWith('http-') ? `${ru ? 'Ошибка сервиса' : 'Service error'}: ${state.error.slice(5)}` : (ru ? 'Нет доступа к прогнозу. Проверьте соединение.' : 'Forecast unavailable. Check your connection.');
  return <details className="settings-disclosure"><summary>{ru ? 'Погода' : 'Weather'}</summary><section className="settings-card weather-settings">
    <Checkbox checked={settings.enabled} onChange={e => weatherService.configure({ enabled: e.target.checked })} label={ru ? 'Фон timeline: солнце и осадки (бета)' : 'Timeline background: sun and precipitation (beta)'} />
    {settings.enabled && <>
      <Checkbox checked={settings.solar} onChange={e => weatherService.configure({ solar: e.target.checked })} label={ru ? 'Солнечный фон' : 'Solar background'} />
      <Checkbox checked={settings.precipitation} onChange={e => weatherService.configure({ precipitation: e.target.checked })} label={ru ? 'Вероятность осадков' : 'Precipitation probability'} />
      <p role="status">{ru ? 'Выбрано и сохранено на устройстве' : 'Selected and saved on this device'}: {settings.location?.name ?? (ru ? 'пока ничего' : 'none yet')}</p>
      <label>{ru ? 'Город' : 'City'}<Input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} /></label>
      <Button disabled={busy} onClick={() => void search()}>{ru ? 'Найти город' : 'Find city'}</Button>
      <div className="weather-search-results">{results.map((v, i) => <Button key={i} onClick={() => choose(v)}>{ru ? 'Выбрать' : 'Use'}: {v.name} ({v.latitude}, {v.longitude})</Button>)}</div>
      <div className="weather-coordinates"><label>{ru ? 'Широта' : 'Latitude'}<Input type="number" min={-90} max={90} step="any" value={latitude} onChange={e => setLatitude(e.target.value)} /></label><label>{ru ? 'Долгота' : 'Longitude'}<Input type="number" min={-180} max={180} step="any" value={longitude} onChange={e => setLongitude(e.target.value)} /></label></div>
      <Button disabled={!latitude.trim() || !longitude.trim()} onClick={saveCoordinates}>{ru ? 'Сохранить координаты' : 'Save coordinates'}</Button>
      <Button disabled={busy} onClick={geolocate}>{ru ? 'Определить моё местоположение' : 'Use my location'}</Button>
      {busy && <p role="status">{ru ? 'Определяем место…' : 'Looking up location…'}</p>}
      {error && <p role="status">{error}</p>}
      <p>{ru ? 'Последняя попытка' : 'Last attempt'}: {date(state.lastAttempt)}<br />{ru ? 'Последнее обновление' : 'Last update'}: {date(state.forecast?.locationKey === (settings.location && `${settings.location.latitude},${settings.location.longitude}`) ? state.forecast?.fetchedAt : undefined)}</p>
      {state.error && <p role="status">{errorText}</p>}
      <Button disabled={!settings.location || !settings.precipitation || state.busy} onClick={() => void weatherService.refresh()}>{state.busy ? (ru ? 'Обновление…' : 'Updating…') : (ru ? 'Обновить прогноз' : 'Refresh forecast')}</Button>
      <p>{ru ? 'Дымка показывает вероятность, а не силу осадков. Прогноз обновляется при запуске и каждый час работы приложения; без сети доступен до 6 часов после загрузки. Солнце рассчитывается офлайн.' : 'Haze shows probability, not precipitation intensity. Forecast refreshes at startup and hourly while the app runs; cached data expires after 6 hours. Sunlight is calculated offline.'}</p>
      <p>{ru ? 'Город и координаты сохраняются на этом устройстве. Для прогноза координаты передаются Open-Meteo; поисковый запрос — сервису поиска городов.' : 'City and coordinates are saved on this device. Forecast requests send coordinates to Open-Meteo; city searches send the search text.'}</p>
      <small><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a> · <a href="https://geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> · <a href="https://github.com/mourner/suncalc" target="_blank" rel="noreferrer">SunCalc</a> · <a href={`${import.meta.env.BASE_URL}suncalc-license.txt`} target="_blank" rel="noreferrer">{ru ? 'Лицензия' : 'License'}</a></small>
    </>}
    {state.storageError && <p role="status">{ru ? 'Не удалось прочитать или сохранить настройки/кэш погоды на устройстве.' : 'Unable to read or save weather settings/cache on this device.'}</p>}
  </section></details>;
}
