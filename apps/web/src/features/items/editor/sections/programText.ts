import { createId, type EventProgramBlock } from '@utm/core';
import { programDateInput, programDateInstant } from './programDates';

export function programDay(origin: number, zone: string, day: number): string {
  const date = programDateInput(origin, zone).slice(0, 10);
  return new Date(Date.parse(`${date}T00:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
}
export function programTimeParts(instant: number, origin: number, zone: string) {
  const local = programDateInput(instant, zone);
  const day = Math.round((Date.parse(`${local.slice(0, 10)}T00:00:00Z`) - Date.parse(`${programDay(origin, zone, 0)}T00:00:00Z`)) / 86400000);
  return { day, time: local.slice(11, local.endsWith(':00') ? 16 : 19) };
}
export function formatProgramText(blocks: EventProgramBlock[], origin: number, zone: string): string {
  return blocks.map((block) => {
    const start = programTimeParts(origin + block.startOffsetSeconds * 1000, origin, zone);
    const end = programTimeParts(origin + block.endOffsetSeconds * 1000, origin, zone);
    return `${start.day ? `+${start.day} ` : ''}${start.time}–${end.day !== start.day ? `+${end.day} ` : ''}${end.time} ${block.title}`;
  }).join('\n');
}
export function parseProgramText(text: string, origin: number, zone: string, previous: EventProgramBlock[] = []): EventProgramBlock[] {
  const parsed = text.split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    const match = line.trim().match(/^(?:\+(\d+)\s+)?(\d{2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(?:\+(\d+)\s+)?(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (!match) throw new Error(`Line ${index + 1}: HH:MM–HH:MM Title`);
    const startDay = Number(match[1] ?? 0), endDay = Number(match[3] ?? startDay);
    if (!Number.isSafeInteger(startDay) || !Number.isSafeInteger(endDay) || startDay > 36500 || endDay > 36500 || ![match[2], match[4]].every((time) => /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time!))) throw new Error(`Line ${index + 1}: invalid time range`);
    const start = programDateInstant(`${programDay(origin, zone, startDay)}T${match[2]}`, zone);
    const end = programDateInstant(`${programDay(origin, zone, endDay)}T${match[4]}`, zone);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Line ${index + 1}: invalid time range`);
    return [{ title: match[5]!.trim(), startOffsetSeconds: (start - origin) / 1000, endOffsetSeconds: (end - origin) / 1000 }];
  });
  // Reserve exact matches first so inserting/reordering lines never steals an existing ID.
  const used = new Set<string>();
  const ids = parsed.map((block) => { const match = previous.find((entry) => !used.has(entry.id) && entry.title === block.title && entry.startOffsetSeconds === block.startOffsetSeconds && entry.endOffsetSeconds === block.endOffsetSeconds); if (match) used.add(match.id); return match?.id; });
  return parsed.map((block, index) => {
    const match = ids[index] ? undefined : previous.find((entry) => !used.has(entry.id) && (entry.title === block.title || entry.startOffsetSeconds === block.startOffsetSeconds && entry.endOffsetSeconds === block.endOffsetSeconds));
    const positional = parsed.length === previous.length && previous[index] && !used.has(previous[index]!.id) ? previous[index]!.id : undefined;
    const id = ids[index] ?? match?.id ?? positional ?? createId(); used.add(id);
    return { id, ...block };
  });
}
