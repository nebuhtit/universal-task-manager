import { createItem, createWorkspace } from '@utm/core';
import { describe, expect, it } from 'vitest';
import { cardWorkspaceUnchanged } from './itemCardDependencies';

describe('card workspace dependencies', () => {
  it('ignores unrelated items and save timestamps for local fields', () => {
    const before = createWorkspace('test');
    const after = { ...before, items: { other: createItem('other', 'task') }, updatedAt: new Date().toISOString() };
    expect(cardWorkspaceUnchanged(before, after, ['title', 'schedule.startAt'])).toBe(true);
    expect(cardWorkspaceUnchanged(before, after)).toBe(true);
    for (const field of ['scripts', 'script.any', 'custom.formula', 'subtasks', 'parent', 'reminders', 'unknown']) {
      expect(cardWorkspaceUnchanged(before, after, [field])).toBe(false);
    }
    expect(cardWorkspaceUnchanged(before, { ...after, calendarPreferences: { ...before.calendarPreferences, language: 'ru' } }, ['title'])).toBe(false);
  });
});
