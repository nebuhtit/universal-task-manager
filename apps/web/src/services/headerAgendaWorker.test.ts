import { afterEach, describe, expect, it, vi } from 'vitest';
import { createItem, createOccurrence, createWorkspace, makeSeries } from '@utm/core';
import { selectHeaderAgenda, type HeaderAgenda } from '../components/layout/headerAgendaModel';
import { createHeaderAgendaRunner, headerAgendaInput } from './headerAgendaWorker';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const now = Date.parse('2026-09-30T10:00:00Z');
const result = (title: string, validUntil = Infinity): HeaderAgenda => ({ next: { id: 'event', title, at: now + 60_000, kind: 'event' }, concurrent: [], additional: 0, validUntil });
function workerFixture() {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    postMessage = vi.fn(); terminate = vi.fn();
    constructor() { FakeWorker.instances.push(this); }
    reply(agenda: HeaderAgenda, id = this.postMessage.mock.lastCall![0].id) { this.onmessage?.({ data: { id, ok: true, agenda, durationMs: 7000 } }); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return FakeWorker;
}

it('preserves selection inputs, including remote recurrences, moved exceptions and tombstones', () => {
  const w = createWorkspace('PRIVATE');
  const base = createItem('Yearly'); base.schedule = { timezone: 'UTC', startAt: '2020-10-01T10:00:00Z', endAt: '2020-10-01T12:00:00Z', dueAt: '2020-10-01T13:00:00Z', travelDuration: 'PT1H' };
  const series = makeSeries(base, 'FREQ=YEARLY'); w.items[series.id] = series;
  const closed = createOccurrence(series, new Date('2026-10-01T10:00:00Z'), 0); closed.state = 'done'; w.items[closed.id] = closed;
  const removed = createOccurrence(series, new Date('2027-10-01T10:00:00Z'), 0); w.tombstones[removed.id] = new Date(now).toISOString();
  const moved = createOccurrence(series, new Date('2028-10-01T10:00:00Z'), 0); moved.schedule!.startAt = '2026-10-02T10:00:00Z'; moved.schedule!.endAt = '2026-10-02T12:00:00Z'; w.items[moved.id] = moved;
  series.bodyMarkdown = 'PRIVATE BODY'; series.extensions = { secret: 'PRIVATE SECRET' };
  const before = JSON.stringify(w), input = headerAgendaInput(w);
  expect(selectHeaderAgenda(input.workspace, now)).toEqual(selectHeaderAgenda(w, now));
  expect(input.key).not.toContain('PRIVATE');
  expect(JSON.stringify(w)).toBe(before);
  series.bodyMarkdown = 'Other body'; series.revision++; w.updatedAt = '2026-10-01T00:00:00Z';
  expect(headerAgendaInput(w).key).toBe(input.key);
  series.schedule!.startAt = '2020-10-02T10:00:00Z';
  expect(headerAgendaInput(w).key).not.toBe(input.key);
});

describe('background header runner', () => {
  it('keeps a slow calculation alive across clock ticks and reuses its result until the boundary', () => {
    const Worker = workerFixture(), accept = vi.fn(), fail = vi.fn();
    const runner = createHeaderAgendaRunner(accept, fail), input = headerAgendaInput(createWorkspace('test'));
    runner.update(input, now);
    for (let second = 1; second < 8; second++) runner.update(input, now + second * 1000);
    expect(Worker.instances).toHaveLength(1);
    const worker = Worker.instances[0]!;
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
    worker.reply(result('Ready', now + 60_000));
    expect(accept).toHaveBeenCalledWith(result('Ready', now + 60_000), input.workspace.workspaceId);
    runner.update(input, now + 59_000); expect(worker.postMessage).toHaveBeenCalledTimes(1);
    runner.update(input, now + 60_000); expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(worker.terminate).not.toHaveBeenCalled();
    runner.dispose(); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('coalesces changes and rejects old results while retaining the last accepted display', () => {
    const Worker = workerFixture(), accept = vi.fn();
    const runner = createHeaderAgendaRunner(accept, vi.fn()), w = createWorkspace('test');
    const item = createItem('Initial'); w.items[item.id] = item;
    runner.update(headerAgendaInput(w), now);
    const worker = Worker.instances[0]!; worker.reply(result('Initial'));
    item.title = 'Second'; runner.update(headerAgendaInput(w), now + 1000);
    item.title = 'Latest'; runner.update(headerAgendaInput(w), now + 2000);
    expect(accept).toHaveBeenCalledTimes(1);
    worker.reply(result('Second'));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(3);
    worker.reply(result('Latest'));
    expect(accept.mock.lastCall![0].next.title).toBe('Latest');
    runner.dispose(); worker.reply(result('Late'));
    expect(accept).toHaveBeenCalledTimes(2);
  });

  it('recalculates after a clock rewind and ignores responses invalidated by elapsed time', () => {
    const Worker = workerFixture(), accept = vi.fn(), runner = createHeaderAgendaRunner(accept, vi.fn());
    const input = headerAgendaInput(createWorkspace('test'));
    runner.update(input, now); runner.update(input, now + 2000);
    const worker = Worker.instances[0]!; worker.reply(result('Expired', now + 1000));
    expect(accept).not.toHaveBeenCalled(); expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.reply(result('Current', now + 60_000));
    runner.update(input, now - 1000); expect(worker.postMessage).toHaveBeenCalledTimes(3);
    runner.dispose();
  });

  it('retains the result on failure and bounds retry attempts', () => {
    vi.useFakeTimers();
    const Worker = workerFixture(), accept = vi.fn(), fail = vi.fn(), runner = createHeaderAgendaRunner(accept, fail);
    const input = headerAgendaInput(createWorkspace('test'));
    runner.update(input, now); Worker.instances[0]!.reply(result('Previous', now + 1000));
    runner.update(input, now + 1000); Worker.instances[0]!.onerror?.();
    expect(fail).toHaveBeenCalledTimes(1); expect(accept).toHaveBeenCalledTimes(1);
    runner.update(input, now + 2000); expect(Worker.instances).toHaveLength(1);
    vi.advanceTimersByTime(10_000); runner.update(input, now + 11_000); expect(Worker.instances).toHaveLength(2);
    runner.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
});
