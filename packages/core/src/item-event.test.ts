import { expect, it } from 'vitest';
import { canManuallyComplete } from './item-event.js';
import { createItem, createWorkspace } from './types.js';
import { migrateWorkspace, validateWorkspace } from './schema.js';
import { recordCompletionTransition } from './item-history.js';
import { syncCompletionCounter } from './completion-goals.js';

it('preserves legacy behavior and opts local events in and out without deleting history', () => {
  const item = createItem('Event', 'event');
  expect(canManuallyComplete(item)).toBe(true);
  item.schedule = { timezone: 'UTC', startAt: '2026-09-22T10:00:00Z', endAt: '2026-09-22T11:00:00Z' };
  expect(canManuallyComplete(item)).toBe(false);
  item.canBeCompleted = true;
  expect(canManuallyComplete(item)).toBe(true);
  const workspace = createWorkspace(); workspace.items[item.id] = item;
  expect(validateWorkspace(workspace).valid).toBe(true);
  expect(migrateWorkspace(workspace).value.items[item.id]?.canBeCompleted).toBe(true);
  item.state = 'done'; recordCompletionTransition(item, 'open', '2026-09-22T11:00:00Z');
  expect(item.completionEntries).toHaveLength(1);
  item.canBeCompleted = false; item.state = 'open';
  item.progress = { mode: 'counter', current: 0, target: 1 };
  syncCompletionCounter(item);
  expect(item.state).toBe('open');
  expect(canManuallyComplete(item)).toBe(false);
  item.state = 'done'; recordCompletionTransition(item, 'open', '2026-09-22T12:00:00Z');
  expect(item.completionEntries).toHaveLength(1);
});

it('keeps a scheduled local task completable in its editor and reminders', () => {
  const task = createItem('Prepare food', 'task');
  task.schedule = { timezone: 'UTC', startAt: '2026-09-23T12:00:00Z', endAt: '2026-09-23T15:00:00Z' };
  expect(canManuallyComplete(task)).toBe(true);
  task.canBeCompleted = false;
  expect(canManuallyComplete(task)).toBe(false);
});
