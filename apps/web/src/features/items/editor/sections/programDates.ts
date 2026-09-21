/** datetime-local values interpreted in the event's timezone, not the device timezone. */
export function programDateInput(instant: number, timeZone: string): string {
  if (!Number.isFinite(instant)) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = (name: string) => parts.find((entry) => entry.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}
export function programDateInstant(value: string, timeZone: string): number {
  if (!value) return NaN;
  const local = value.length === 16 ? `${value}:00` : value;
  const target = Date.parse(`${local}Z`);
  let instant = target;
  for (let index = 0; index < 4; index += 1) {
    const rendered = programDateInput(instant, timeZone);
    if (rendered === local) return instant;
    instant += target - Date.parse(`${rendered}Z`);
  }
  return NaN; // nonexistent local time during the spring DST transition
}
