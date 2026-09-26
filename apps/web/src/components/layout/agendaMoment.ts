import { zonedDateStart } from '@utm/core';

const key = (at: number, zone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
export function nextAgendaMidnight(now: number, zone: string): number {
  const tomorrow = new Date(`${key(now, zone)}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return +zonedDateStart(tomorrow.toISOString().slice(0, 10), zone);
}
export function agendaMoment(at: number, now: number, zone: string) {
  const targetDay = key(at, zone), today = key(now, zone);
  const tomorrow = key(nextAgendaMidnight(now, zone), zone);
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(at).replace(/^0/, '');
  return { text: targetDay === today || targetDay === tomorrow ? clock : `${targetDay.slice(8, 10)}.${targetDay.slice(5, 7)} ${clock}`, tomorrow: targetDay === tomorrow };
}
