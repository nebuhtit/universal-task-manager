import type { UniversalItem } from '@utm/core';

const KEY = 'utm:creationDefaultBounds';

/** Provenance for the new-item form only; never infer user intent from timestamps. */
export function markCreationDefaultBounds(item: UniversalItem): UniversalItem {
  return { ...item, extensions: { ...item.extensions, [KEY]: { startAt: item.schedule?.startAt, endAt: item.schedule?.endAt } } };
}

export function hasCreationDefaultBounds(item: UniversalItem): boolean {
  const bounds = item.extensions?.[KEY] as { startAt?: string; endAt?: string } | undefined;
  return Boolean(bounds?.startAt && bounds.startAt === item.schedule?.startAt && bounds.endAt === item.schedule?.endAt);
}

export function clearCreationDefaultBounds(item: UniversalItem): UniversalItem {
  const extensions = { ...item.extensions };
  delete extensions[KEY];
  return { ...item, extensions };
}

export function withoutCreationDefaultBounds(item: UniversalItem): UniversalItem {
  if (!item.schedule || !hasCreationDefaultBounds(item)) return item;
  const schedule = { ...item.schedule };
  delete schedule.startAt;
  delete schedule.endAt;
  return { ...clearCreationDefaultBounds(item), schedule };
}
