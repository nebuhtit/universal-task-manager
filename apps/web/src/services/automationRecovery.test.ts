import { expect, it } from 'vitest';
import { collectScheduledEvents, createWorkspace } from '@utm/core';
import * as Automerge from '@automerge/automerge';

it('repairs a broken schedule transactionally while preserving the source document', () => {
  const workspace = createWorkspace('Recovery', new Date('2026-09-01T00:00:00Z'));
  workspace.automations.bad = { id: 'bad', name: 'Bad', enabled: true, trigger: { type: 'time.schedule', rrule: 'BROKEN' }, condition: { source: 'true' }, actions: [], missedPolicy: 'run_each', maxDepth: 3, cooldownMs: 0 };
  const original = Automerge.from(workspace as unknown as Record<string, unknown>) as unknown as Automerge.Doc<typeof workspace>;
  const repaired = Automerge.change(Automerge.clone(original), (draft) => { collectScheduledEvents(draft, new Date('2026-09-04T00:00:00Z')); });
  expect(original.automations.bad!.enabled).toBe(true);
  expect(repaired.automations.bad!.enabled).toBe(false);
  expect(Automerge.load<typeof workspace>(Automerge.save(repaired)).automations.bad!.trigger.rrule).toBe('BROKEN');
});
