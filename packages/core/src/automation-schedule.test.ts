import { describe, expect, it } from 'vitest';
import { collectScheduledEvents } from './automation';
import { createWorkspace, type AutomationRule } from './types';

const rule = (id: string, rrule = 'FREQ=DAILY'): AutomationRule => ({ id, name: id, enabled: true, trigger: { type: 'time.schedule', rrule }, condition: { source: 'true' }, actions: [], missedPolicy: 'run_each', maxDepth: 3, cooldownMs: 0 });
describe('fault-tolerant scheduled automation collection', () => {
  it('retains and disables a broken rule while collecting valid rules', () => {
    const workspace = createWorkspace('Recovery', new Date('2026-09-01T00:00:00Z'));
    workspace.automations = { bad: rule('bad', 'BROKEN'), good: rule('good') };
    const events = collectScheduledEvents(workspace, new Date('2026-09-04T00:00:00Z'));
    expect(events).toHaveLength(2);
    expect(workspace.automations.bad).toMatchObject({ enabled: false, trigger: { rrule: 'BROKEN' } });
    expect(workspace.automations.bad!.disabledReason).toContain('repair');
    expect(workspace.automations.good!.enabled).toBe(true);
  });
  it('caps dense missed schedules during enumeration', () => {
    const workspace = createWorkspace('Dense', new Date('2020-01-01T00:00:00Z'));
    workspace.automations.dense = rule('dense', 'FREQ=SECONDLY');
    expect(collectScheduledEvents(workspace, new Date('2026-09-08T00:00:00Z'))).toHaveLength(1000);
  });
  it('keeps run-once boundaries and skips missed schedules without enumeration', () => {
    const workspace = createWorkspace('Policies', new Date('2026-09-01T00:00:00Z'));
    workspace.automations.once = { ...rule('once'), missedPolicy: 'run_once' };
    workspace.automations.skip = { ...rule('skip', 'FREQ=SECONDLY'), missedPolicy: 'skip' };
    expect(collectScheduledEvents(workspace, new Date('2026-09-04T00:00:00Z')).map((event) => event.at)).toEqual(['2026-09-03T00:00:00.000Z']);
    expect(collectScheduledEvents(workspace, new Date('2026-09-01T00:00:00Z'))).toEqual([]);
  });
});
