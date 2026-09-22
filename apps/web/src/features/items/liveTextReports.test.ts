import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, migrateWorkspace } from '@utm/core';
import { parseEntry } from '../../../quick-entry-lab/parser';
import { clearLiveTextReports, readLiveTextReports, saveLiveTextReport } from './liveTextReports';

describe('Live text reports', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
  beforeEach(() => { memory.clear(); vi.stubGlobal('localStorage', storage); });
  afterEach(() => vi.unstubAllGlobals());
  const now = new Date('2026-09-22T10:00:00Z');
  const report = { input: 'Тест завтра 15:00', parsed: parseEntry('Тест завтра 15:00', now), expected: 'Начало завтра в 15:00', referenceTime: now.toISOString() };
  it('keeps readable, bounded reports separate for each workspace', () => {
    for (let i = 0; i < 102; i++) saveLiveTextReport('one', { ...report, expected: String(i) });
    expect(readLiveTextReports('one')).toHaveLength(100);
    expect(readLiveTextReports('one')[0]?.expected).toBe('2');
    expect([...memory.values()][0]).toContain(report.input);
    expect(readLiveTextReports('two')).toEqual([]);
    clearLiveTextReports('one'); expect(readLiveTextReports('one')).toEqual([]);
  });
  it('surfaces failed writes and preserves a corrupted log for recovery', () => {
    memory.set('utm:live-text-reports:one', '{broken');
    expect(() => saveLiveTextReport('one', report)).toThrow();
    expect(memory.get('utm:live-text-reports:one')).toBe('{broken');
    vi.stubGlobal('localStorage', { ...storage, setItem: () => { throw new Error('Quota exceeded'); } });
    expect(() => saveLiveTextReport('two', report)).toThrow('Quota exceeded');
  });
  it('preserves disabled suggestions through workspace normalization and JSON restore', () => {
    const workspace = createWorkspace('Test');
    workspace.calendarPreferences.liveTextSuggestions = false;
    expect(migrateWorkspace(JSON.parse(JSON.stringify(workspace))).value.calendarPreferences.liveTextSuggestions).toBe(false);
  });
});
