import { expect, it } from 'vitest';
import { programDateInput, programDateInstant } from './programDates';
it('edits event-zone wall time across midnight and rejects missing DST times', () => {
  const instant = programDateInstant('2026-09-22T00:15', 'Europe/Istanbul');
  expect(new Date(instant).toISOString()).toBe('2026-09-21T21:15:00.000Z');
  expect(programDateInput(instant, 'Europe/Istanbul')).toBe('2026-09-22T00:15:00');
  expect(Number.isNaN(programDateInstant('2026-03-08T02:30', 'America/New_York'))).toBe(true);
});
