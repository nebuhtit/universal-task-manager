import { afterEach, describe, expect, it, vi } from 'vitest';
import { LatestPersistenceQueue } from './workspacePersistence';
import { clearPerformanceProfiles, profileInput, readPerformanceProfiles, setPerformanceProfilingEnabled } from './performanceProfile';

afterEach(() => { clearPerformanceProfiles(); setPerformanceProfilingEnabled(false); vi.useRealTimers(); });

describe('LatestPersistenceQueue', () => {
  it('measures queue wait and coalescing against the originating action', async () => {
    vi.useFakeTimers(); setPerformanceProfilingEnabled(true);
    const origin = profileInput.start('click', 0)!;
    const persisted: number[] = [];
    const queue = new LatestPersistenceQueue<number>(async value => { persisted.push(value); }, () => undefined, () => undefined, 80);
    queue.enqueue(1); queue.enqueue(2);
    profileInput.frame(origin);
    profileInput.start('input', 0);
    await vi.advanceTimersByTimeAsync(80);
    const report = readPerformanceProfiles().at(-1)!;
    expect(persisted).toEqual([2]);
    expect(report.aggregates.find(entry => entry.stage === 'save.queue')).toMatchObject({ count: 1, metrics: { coalesced: 1 } });
    expect(report.actions[0]!.spans.some(span => span.stage === 'save.queue')).toBe(true);
    expect(report.actions[1]!.spans.some(span => span.stage === 'save.queue')).toBe(false);
  });
  it('coalesces rapid optimistic changes into the latest save', async () => {
    vi.useFakeTimers();
    const persisted: number[] = [];
    const queue = new LatestPersistenceQueue<number>(async (value) => { persisted.push(value); }, () => undefined, () => undefined, 80);
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    await vi.advanceTimersByTimeAsync(80);
    expect(persisted).toEqual([3]);
    vi.useRealTimers();
  });

  it('persists only the latest change that arrives during an active write', async () => {
    let release: (() => void) | undefined;
    const persisted: number[] = [];
    const queue = new LatestPersistenceQueue<number>(async (value) => {
      persisted.push(value);
      if (value === 1) await new Promise<void>((resolve) => { release = resolve; });
    }, () => undefined, () => undefined, 0);
    queue.enqueue(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    queue.enqueue(2);
    queue.enqueue(3);
    release?.();
    await queue.flush();
    expect(persisted).toEqual([1, 3]);
  });

  it('retains a failed latest value and retries it on flush', async () => {
    let attempts = 0;
    const failures: unknown[] = [];
    const queue = new LatestPersistenceQueue<number>(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary');
    }, () => undefined, (reason) => failures.push(reason), 0);
    queue.enqueue(7);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await queue.flush();
    expect(attempts).toBe(2);
    expect(failures).toHaveLength(1);
  });
});
