import { expect, it } from 'vitest';
import { completionStatistics, createItem, recordExpiredItemTimer } from './index.js';

it('records the target once, not hours spent with the phone closed', () => {
  const item = createItem('Timer');
  const start = Date.parse('2026-09-25T10:00:00Z');
  item.activeTimer = { id: 'timer-1', mode: 'timer', startedAt: new Date(start).toISOString(), targetSeconds: 600 };
  expect(recordExpiredItemTimer(item, start + 1000)).toBe(false);
  expect(recordExpiredItemTimer(item, start + 3600000)).toBe(true);
  expect(recordExpiredItemTimer(item, start + 7200000)).toBe(false);
  expect(item.completionEntries).toHaveLength(1);
  expect(item.completionEntries![0]).toMatchObject({ kind: 'automatic', at: '2026-09-25T10:10:00.000Z' });
  expect(item.actualTimeEntries![0]!.durationSeconds).toBe(600);
});
it('does not automatically count manually stopped timers or stopwatches', () => {
  const item = createItem('Stopped');
  item.activeTimer = { id: 'stop', mode: 'timer', startedAt: '2026-09-25T10:00:00Z', targetSeconds: 600, stoppedAt: '2026-09-25T10:01:00Z', durationSeconds: 60 };
  expect(recordExpiredItemTimer(item, Date.now() + 86400000)).toBe(false);
  item.activeTimer.mode = 'stopwatch'; delete item.activeTimer.stoppedAt;
  expect(recordExpiredItemTimer(item, Date.now() + 86400000)).toBe(false);
});
it('averages recorded completions, excludes revoked and unknown durations, sums split records', () => {
  const item = createItem('Stats');
  item.completionEntries = ['a', 'b', 'c', 'd'].map(id => ({ id, at: item.createdAt, kind: 'manual', comment: '', ...(id === 'd' ? { revokedAt: item.createdAt } : {}) }));
  item.actualTimeEntries = [['a', 60], ['a', 60], ['b', 240], ['d', 999]].map(([id, seconds], index) => ({ id: String(index), completionId: String(id), durationSeconds: Number(seconds), source: 'manual', comment: '' }));
  expect(completionStatistics([item])).toEqual({ count: 3, timedCount: 2, totalSeconds: 360, averageSeconds: 180 });
});
