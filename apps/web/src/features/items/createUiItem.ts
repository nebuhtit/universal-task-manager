import { createItem, type ItemPreset } from '@utm/core';

/** Ordinary capture starts as an undated task; calendar slots supply their own bounds. */
export function createUiItem(title = '', preset: ItemPreset = 'task', now = new Date()) {
  const item = createItem(title, preset, now);
  item.schedule = { ...item.schedule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, estimatedDuration: 'PT10M' };
  if (preset === 'task') item.canBeCompleted = true;
  return item;
}
