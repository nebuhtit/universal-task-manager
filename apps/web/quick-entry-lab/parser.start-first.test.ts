import { describe, expect, it } from 'vitest';
import { parseEntry, suggest } from './parser';

const now = new Date(2026, 8, 21, 16);
const sunday = new Date(2026, 8, 27, 15).toISOString();
const sundayEnd = new Date(2026, 8, 27, 16).toISOString();

describe('start-first quick entry', () => {
  it('treats an unlabelled date as a one-hour event', () => {
    expect(parseEntry('даша вс 15 00', now)).toMatchObject({ title: 'даша', start: sunday, end: sundayEnd, due: null, durationMinutes: 60, errors: [] });
    expect(parseEntry('вс 15:00 даша', now)).toMatchObject({ title: 'даша', start: sunday, end: sundayEnd, due: null, durationMinutes: 60, errors: [] });
  });
  it('treats до as due-only with a ten-minute default duration', () => {
    expect(parseEntry('домашнее задание до вс 15 00', now)).toMatchObject({ title: 'домашнее задание', due: sunday, start: null, end: null, durationMinutes: 10, errors: [] });
    expect(parseEntry('до вс 15 00 домашнее задание', now)).toMatchObject({ title: 'домашнее задание', due: sunday, start: null, end: null, durationMinutes: 10, errors: [] });
    expect(parseEntry('домашнее задание до 25 сентября 2026 в 15:10', now)).toMatchObject({ title: 'домашнее задание', due: new Date(2026, 8, 25, 15, 10).toISOString(), start: null, end: null, durationMinutes: 10, errors: [] });
  });
  it('respects explicit duration and event end', () => {
    expect(parseEntry('даша вс 15 00 длительность 30м', now)).toMatchObject({ start: sunday, end: new Date(2026, 8, 27, 15, 30).toISOString(), durationMinutes: 30, errors: [] });
    expect(parseEntry('домашнее задание до вс 15 00 длительность 25м', now)).toMatchObject({ due: sunday, start: null, end: null, durationMinutes: 25, errors: [] });
    expect(parseEntry('даша вс 15 00 конец вс 17 00', now)).toMatchObject({ start: sunday, end: new Date(2026, 8, 27, 17).toISOString(), durationMinutes: 120, errors: [] });
  });
  it('anchors automatic reminders to event opens or due as applicable', () => {
    expect(parseEntry('даша вс 15 00 напомнить 30м', now).reminders[0]).toMatchObject({ anchor: 'start', at: new Date(2026, 8, 27, 14, 30).toISOString() });
    expect(parseEntry('домашнее задание до вс 15 00 напомнить 30м', now).reminders[0]).toMatchObject({ anchor: 'due', at: new Date(2026, 8, 27, 14, 30).toISOString() });
  });
  it('keeps ordinary до in a title and rejects duplicate starts', () => {
    expect(parseEntry('До дома пешком', now)).toMatchObject({ title: 'До дома пешком', start: null, due: null, durationMinutes: null, errors: [] });
    expect(parseEntry('даша вс 15 00 начало вс 16 00', now).errors).toContain('Параметр «start» указан несколько раз.');
  });
  it('offers due dates after до', () => {
    const options = suggest('домашнее задание до ', 'домашнее задание до '.length, now).options;
    expect(options[0]?.label).toMatch(/^до /);
  });
});
