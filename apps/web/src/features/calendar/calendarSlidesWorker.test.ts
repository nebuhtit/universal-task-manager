import { describe, expect, it } from 'vitest';
import { createItem, createWorkspace, zonedDateStart, type WorkspaceDocument } from '@utm/core';
import { createCalendarSlidesRunner } from './calendarSlidesWorker';
import { createCalendarPageCache, prepareCalendarSlides, type CalendarSlideRequest } from './calendarPageCache';
import { completionHoldsSnapshot, setCompletionHold } from '../views/viewSelectors';
import { calendarProjectionPadding, createCalendarProjectionCache } from './calendarProjectionCache';

const now = new Date('2026-09-24T08:00:00Z');
const request: CalendarSlideRequest = { ranges: [{ start: '2026-09-21', end: '2026-09-28' }], timelines: ['2026-09-24'], now: +now, capacityNow: +now, allDayOpen: true };
function fixture() {
  const workspace = createWorkspace('Worker slides', now);
  workspace.calendarPreferences.timezone = 'UTC';
  const work = createItem('Work', 'event', now); work.id = 'work';
  work.schedule = { timezone: 'UTC', startAt: '2026-09-24T09:00:00Z', endAt: '2026-09-24T16:00:00Z', estimatedDuration: 'PT7H' };
  work.recurrence = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', timezone: 'UTC', anchor: 'schedule', autoRenew: true, rdates: [], exdates: [], closeAt: 'next_activation' }; work.role = 'series_template';
  const task = createItem('Inside Work', 'task', now); task.id = 'task';
  task.relations = [{ id: 'relation', type: 'scheduled_within', targetId: work.id }];
  task.schedule = { timezone: 'UTC', estimatedDuration: 'PT30M' };
  workspace.items = { work, task };
  return workspace;
}
class FakeWorker {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  messages: any[] = [];
  terminated = false;
  postMessage(message: unknown) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  reply(id: number, result: unknown) { this.onmessage?.call(this as unknown as Worker, { data: { id, ok: true, result, durationMs: 1 } } as MessageEvent); }
}

describe('optional calendar worker', () => {
  it('prepares exact unfiltered clock boundaries for every day without main-thread projection on promotion', () => {
    const workspace = fixture();
    workspace.calendarPreferences.timezone = 'Europe/Berlin';
    workspace.calendarPreferences.dayView.filter.source = 'id == "task"'; // Hidden blocks still affect the clock.
    const overnight = createItem('Overnight', 'event', now); overnight.id = 'overnight';
    overnight.schedule = { timezone: 'Europe/Berlin', startAt: '2026-09-23T22:00:00Z', endAt: '2026-09-24T06:00:00Z' };
    workspace.items.overnight = overnight;
    const main = createCalendarPageCache(workspace.workspaceId), worker = createCalendarPageCache(workspace.workspaceId);
    const result = structuredClone(prepareCalendarSlides(worker, structuredClone(workspace), request));
    main.acceptPrepared(workspace, now, now, true, completionHoldsSnapshot(), result);
    const counters = { ...main.evaluator.projections.counters };
    const reference = createCalendarProjectionCache(), zone = workspace.calendarPreferences.timezone;
    const { padding } = calendarProjectionPadding(Object.values(reference.workspaceFor(workspace).items));
    const { start, end } = request.ranges[0]!;
    for (const key of Object.keys(result.ranges[0]!.boundaries.days)) {
      const next = new Date(Date.parse(key + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
      const rows = [...reference.project(workspace, zonedDateStart(start, zone), zonedDateStart(end, zone)), ...reference.project(workspace, new Date(+zonedDateStart(key, zone) - padding), new Date(+zonedDateStart(next, zone) + padding))];
      expect(main.peekProjectionBoundaries(workspace, start, end, key)).toEqual(rows.flatMap(row => [row.schedule.availableFrom, row.schedule.startAt, row.schedule.endAt, row.schedule.dueAt]).map(value => Date.parse(value ?? '')).filter(Number.isFinite));
    }
    expect(main.evaluator.projections.counters).toEqual(counters);
    const changed = structuredClone(workspace); changed.items.overnight!.schedule!.endAt = '2026-09-24T07:00:00Z';
    expect(main.peekProjectionBoundaries(changed, start, end, '2026-09-24')).toBeUndefined();
    const before = main.peekProjectionBoundaries(workspace, start, end, '2026-09-24');
    main.rangeFor(workspace, start, end, now, new Date(+now + 60_000), false);
    expect(main.peekProjectionBoundaries(workspace, start, end, '2026-09-24')).toEqual(before);
    expect(main.peekProjectionBoundaries(workspace, start, end, '2026-10-01')).toBeUndefined();
  });
  it('transfers exact read-only results through the existing bounded cache, including recurrence and rr', () => {
    const workspace = fixture(), before = JSON.stringify(workspace);
    const result = structuredClone(prepareCalendarSlides(createCalendarPageCache(workspace.workspaceId), structuredClone(workspace), request));
    expect(result.ranges[0]!.value.calendar).not.toHaveProperty('workspace');
    const main = createCalendarPageCache(workspace.workspaceId), completion = completionHoldsSnapshot();
    expect(main.acceptPrepared(workspace, now, now, true, completion, result)).toBe(true);
    const reference = createCalendarPageCache(workspace.workspaceId);
    expect(main.rangeFor(workspace, request.ranges[0]!.start, request.ranges[0]!.end, now, now, true)).toEqual(reference.rangeFor(workspace, request.ranges[0]!.start, request.ranges[0]!.end, now, now, true));
    expect(main.timelineFor(workspace, request.timelines[0]!, now)).toEqual(reference.timelineFor(workspace, request.timelines[0]!, now));
    expect(main.evaluator.counters.dayCalculations).toBe(0);
    const changed = structuredClone(workspace); changed.items.task!.title = 'Changed without revision';
    expect(main.peekRange(changed, request.ranges[0]!.start, request.ranges[0]!.end, now, now, true)).toBeUndefined();
    setCompletionHold('task', { previous: workspace.items.task!, undoUntil: Date.now() + 3000, removeAt: Date.now() + 3200 });
    try { expect(main.acceptPrepared(workspace, now, now, true, completion, result)).toBe(false); }
    finally { setCompletionHold('task'); }
    expect(JSON.stringify(workspace)).toBe(before);
  });

  it('reuses the transferred snapshot and ignores late replies after navigation/lock', async () => {
    const worker = new FakeWorker(), runner = createCalendarSlidesRunner(() => worker);
    const workspace = fixture();
    const first = runner.prepare(workspace, request, new AbortController().signal);
    const message = worker.messages.at(-1);
    expect(message.kind).toBe('prepare'); worker.reply(message.id, { ranges: [], timelines: [] });
    expect(await first).toEqual({ ranges: [], timelines: [] });
    const count = worker.messages.length, abort = new AbortController();
    const second = runner.prepare(workspace, request, abort.signal);
    expect(worker.messages.slice(count).map(message => message.kind)).toEqual(['prepare']);
    abort.abort(); expect(await second).toBeUndefined(); expect(worker.terminated).toBe(true);
    worker.reply(worker.messages.at(-1).id, { ranges: ['stale'], timelines: [] });
    runner.dispose();
  });

  it('yields between snapshot batches and can cancel before sending a calculation', async () => {
    const worker = new FakeWorker(), runner = createCalendarSlidesRunner(() => worker);
    const workspace = fixture();
    for (let i = 0; i < 100; i++) workspace.items[`item-${i}`] = { ...workspace.items.task!, id: `item-${i}` };
    const abort = new AbortController(), result = runner.prepare(workspace, request, abort.signal);
    expect(worker.messages.filter(message => message.kind === 'items')).toHaveLength(1);
    abort.abort(); expect(await result).toBeUndefined();
    expect(worker.messages.some(message => message.kind === 'prepare')).toBe(false);
    expect(worker.terminated).toBe(true); runner.dispose();
  });

  it('does not run synchronous prefetch when a Worker cannot start', async () => {
    const runner = createCalendarSlidesRunner(() => { throw new Error('unavailable'); });
    expect(await runner.prepare(fixture(), request, new AbortController().signal)).toBeUndefined(); runner.dispose();
  });
});
