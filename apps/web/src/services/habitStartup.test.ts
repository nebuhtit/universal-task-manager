import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as Automerge from '@automerge/automerge';
import { beforeAll, describe, expect, it } from 'vitest';
import { consolidateHabitOccurrences, createItem, createOccurrence, createWorkspace, makeSeries, type WorkspaceDocument } from '@utm/core';

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  await Automerge.initializeWasm(readFileSync(require.resolve('@automerge/automerge/automerge.wasm')));
});

function fixture() {
  const workspace = createWorkspace();
  const item = createItem('Habit');
  item.schedule = { timezone: 'UTC', startAt: '2030-01-07T09:00:00.000Z' };
  const series = makeSeries(item, 'FREQ=DAILY');
  series.habit = { target: 1, unit: 'times', streakMode: 'manual_only', completedDates: ['2030-01-05', '2030-01-06'] };
  workspace.items[series.id] = series;
  return { workspace, series };
}

describe('habit startup normalization', () => {
  it('does not create CRDT changes or require a save when already normalized', () => {
    const { workspace } = fixture();
    const source = Automerge.from(workspace as unknown as Record<string, unknown>) as unknown as Automerge.Doc<WorkspaceDocument>;
    const next = Automerge.change(source, draft => { expect(consolidateHabitOccurrences(draft as WorkspaceDocument)).toBe(0); });
    expect(next).toBe(source);
    expect(Automerge.getHeads(next)).toEqual(Automerge.getHeads(source));
  });

  it('retains completed dates and timer history while removing legacy cycles, then becomes a no-op', () => {
    const { workspace, series } = fixture();
    series.habit!.completedDates = ['2030-01-06', '2030-01-05', '2030-01-05'];
    const occurrence = createOccurrence(series, new Date('2030-01-07T09:00:00.000Z'), 0);
    occurrence.state = 'done';
    occurrence.timerHistory = [{ id: 'timer', mode: 'timer', startedAt: '2030-01-07T09:00:00.000Z', endedAt: '2030-01-07T09:10:00.000Z', durationSeconds: 600 }];
    workspace.items[occurrence.id] = occurrence;
    expect(consolidateHabitOccurrences(workspace, new Date('2030-01-07T10:00:00.000Z'))).toBe(1);
    expect(series.habit!.completedDates).toEqual(['2030-01-05', '2030-01-06', '2030-01-07']);
    expect(series.timerHistory).toEqual(occurrence.timerHistory.map(entry => ({ ...entry, recurrenceId: occurrence.occurrence!.recurrenceId })));
    expect(workspace.items[occurrence.id]).toBeUndefined();
    expect(workspace.tombstones[occurrence.id]).toBe('2030-01-07T10:00:00.000Z');
    const dates = series.habit!.completedDates;
    expect(consolidateHabitOccurrences(workspace)).toBe(0);
    expect(series.habit!.completedDates).toBe(dates);
  });
});
