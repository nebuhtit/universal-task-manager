import type { UniversalItem } from './types.js';

/** Adopted Google masters keep their exact source identity in their stable ID,
 * even when a portable backup has intentionally removed the live connection. */
export function googleSeriesIdentity(item: Pick<UniversalItem, 'id' | 'role'>): { calendarId: string; eventId: string } | undefined {
  if (item.role !== 'series_template') return undefined;
  const parts = /^google-series:([^:]+):([^:]+)$/.exec(item.id);
  if (!parts) return undefined;
  try {
    const calendarId = decodeURIComponent(parts[1]!);
    return calendarId ? { calendarId, eventId: parts[2]! } : undefined;
  } catch { return undefined; }
}
