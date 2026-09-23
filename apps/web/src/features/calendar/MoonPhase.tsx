import SunCalc from 'suncalc';
import { dayBounds } from './timelineLayout';

export function MoonPhase({ dateKey, zone, ru }: { dateKey: string; zone: string; ru: boolean }) {
  const day = dayBounds(dateKey, zone);
  const phase = SunCalc.getMoonIllumination(new Date((day.start + day.end) / 2)).phase;
  const waxing = phase < 0.5;
  const limit = Math.cos(2 * Math.PI * phase) * (waxing ? 1 : -1);
  const ys = Array.from({ length: 25 }, (_, index) => 2 + index * 20 / 24);
  const x = (y: number) => 12 + limit * Math.sqrt(Math.max(0, 100 - (y - 12) ** 2));
  const edge = waxing ? 'M12 2 A10 10 0 0 1 12 22' : 'M12 2 A10 10 0 0 0 12 22';
  const path = `${edge} ${ys.reverse().map(y => `L${x(y).toFixed(2)} ${y.toFixed(2)}`).join(' ')} Z`;
  const names = ru ? ['Новолуние', 'Растущая Луна', 'Полнолуние', 'Убывающая Луна'] : ['New moon', 'Waxing moon', 'Full moon', 'Waning moon'];
  const label = names[phase < 0.125 || phase >= 0.875 ? 0 : phase < 0.375 ? 1 : phase < 0.625 ? 2 : 3];
  return <svg className="calendar-moon-phase" viewBox="0 0 24 24" role="img" aria-label={label}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1"/><path d={path} fill="currentColor" /></svg>;
}
