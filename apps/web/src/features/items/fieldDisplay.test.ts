import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, itemJsonSchema } from '@utm/core';
import { displayViewValue, isItemTemplate, readItemField, relationContext, viewFieldLabel, viewFieldOptions } from './fieldDisplay';

describe('item field display helpers', () => {
  it('calculates a display duration from item dates', () => {
    const item = createItem('Timed item');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-26T10:00:00.000Z', endAt: '2026-08-26T11:30:00.000Z' };
    expect(readItemField(item, 'schedule.estimatedDuration')).toBe('PT90M');
    expect(displayViewValue('PT90M', 'schedule.estimatedDuration')).toBe('1 h 30 min');
  });

  it('resolves parent and child fields from the universal relation model', () => {
    const workspace = createWorkspace('Relations');
    const parent = createItem('Parent');
    const child = createItem('Child');
    parent.relations.push({ id: 'rel-1', type: 'parent', targetId: child.id });
    workspace.items[parent.id] = parent;
    workspace.items[child.id] = child;
    expect(relationContext(workspace, parent)).toMatchObject({ isParent: true, childDepth: 1 });
    expect(relationContext(workspace, child)).toMatchObject({ isSubtask: true, parentDepth: 1 });
    expect(readItemField(child, 'parent', workspace)).toBe('Parent');
  });

  it('keeps custom labels and template markers inside the items feature', () => {
    const workspace = createWorkspace('Fields');
    workspace.customFields.example = { id: 'example', key: 'score', label: 'Score', kind: 'number', required: false };
    expect(viewFieldLabel(workspace, 'custom.score')).toBe('Score');
    const template = createItem('Template');
    template.extensions = { 'utm:template': true };
    expect(isItemTemplate(template)).toBe(true);
  });

  it('exposes every normal nested family and item script result to saved views', () => {
    const workspace = createWorkspace('View fields');
    const item = createItem('Computed');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-26T12:00:10.000Z' };
    item.scripts = [{ id: 'remaining', key: 'remaining', label: 'Time remaining', source: 'secondsUntil(schedule.startAt)', resultKind: 'number' }];
    workspace.items[item.id] = item;
    const paths = new Set(viewFieldOptions(workspace).map((field) => field.path));
    expect([...paths]).toEqual(expect.arrayContaining([
      'schedule.startAt', 'recurrence.rrule', 'recurrence.anchor', 'progress.mode', 'progress.current', 'habit.completedDates',
      'closure.automationId', 'occurrence.templateRevision', 'recurrenceOverride.kind', 'scripts', 'script.remaining',
    ]));
    expect(readItemField(item, 'scripts', workspace, new Date('2026-08-26T12:00:00.000Z'))).toBe('Time remaining: 10');
  });

  it('recalculates a script result for each supplied second', () => {
    const workspace = createWorkspace('Live script');
    const item = createItem('Countdown');
    item.schedule = { timezone: 'UTC', startAt: '2026-08-26T12:00:10.000Z' };
    item.scripts = [{ id: 'remaining', key: 'remaining', label: 'Seconds remaining', source: 'secondsUntil(schedule.startAt)', resultKind: 'number' }];
    workspace.items[item.id] = item;
    expect(readItemField(item, 'script.remaining', workspace, new Date('2026-08-26T12:00:00.000Z'))).toBe(10);
    expect(readItemField(item, 'script.remaining', workspace, new Date('2026-08-26T12:00:01.000Z'))).toBe(9);
    expect(readItemField(item, 'scripts', workspace, new Date('2026-08-26T12:00:00.000Z'))).toBe('Seconds remaining: 10');
    expect(readItemField(item, 'scripts', workspace, new Date('2026-08-26T12:00:01.000Z'))).toBe('Seconds remaining: 9');
  });

  it('keeps every user-meaningful item property represented in the View field catalog', () => {
    const workspace = createWorkspace('Catalog audit');
    workspace.customFields.score = { id: 'score', key: 'score', label: 'Score', kind: 'number', required: false };
    const item = createItem('Computed'); item.scripts = [{ id: 'remaining', key: 'remaining', label: 'Remaining', source: 'timeUntil(schedule.startAt)', resultKind: 'text' }]; workspace.items[item.id] = item;
    const paths = viewFieldOptions(workspace).map((field) => field.path);
    const represented = (property: string) => paths.some((path) => path === property || path.startsWith(`${property}.`) || property === 'areas' && path === 'area' || property === 'projects' && path === 'project' || property === 'custom' && path.startsWith('custom.') || property === 'scripts' && path.startsWith('script.'));
    const missing = Object.keys(itemJsonSchema.properties).filter((property) => property !== 'extensions' && !represented(property));
    expect(missing).toEqual([]);
  });
});
