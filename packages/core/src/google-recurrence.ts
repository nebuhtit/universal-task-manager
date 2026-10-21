import type { GoogleCalendarEvent } from './google-calendar.js';
import type { UniversalItem } from './types.js';
import { zonedDateTime } from './view-statistics.js';

/** Preserve every supported Google exception; never silently simplify a rule. */
export function googleRecurrence(event: GoogleCalendarEvent, zone: string): NonNullable<UniversalItem['recurrence']> {
  const rules = event.recurrence ?? [];
  const rr = rules.filter(line => line.startsWith('RRULE:'));
  if (rr.length !== 1) throw new Error('This Google recurrence cannot yet be edited as a UTM series.');
  const result: NonNullable<UniversalItem['recurrence']> = { rrule: rr[0]!.slice(6), timezone: zone, anchor: 'schedule', closeAt: 'next_activation', activationOffset: 'PT0M', autoRenew: true, rdates: [], exdates: [] };
  for (const line of rules.filter(line => !line.startsWith('RRULE:'))) {
    const separator = line.indexOf(':'); const header = line.slice(0, separator); const key = header.split(';')[0];
    if (key !== 'RDATE' && key !== 'EXDATE') throw new Error('Unsupported Google recurrence property. No series was changed.');
    const timezone = header.match(/TZID=([^;]+)/)?.[1] ?? zone;
    for (const value of line.slice(separator + 1).split(',')) {
      const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
      if (!match) throw new Error('Unsupported Google recurrence date. No series was changed.');
      const date = `${match[1]}-${match[2]}-${match[3]}`;
      const instant = match[7] ? new Date(`${date}T${match[4]}:${match[5]}:${match[6]}Z`) : new Date(zonedDateTime(date, Number(match[4] ?? 0), Number(match[5] ?? 0), timezone).getTime() + Number(match[6] ?? 0) * 1000);
      result[key === 'RDATE' ? 'rdates' : 'exdates'].push(instant.toISOString());
    }
  }
  return result;
}
