import { afterEach, expect, it, vi } from 'vitest';
import { createItem, createWorkspace } from '@utm/core';
import { reconcileOffMainThread } from './recurrenceWorker';
afterEach(() => vi.unstubAllGlobals());
it('opens a workspace without recurrence without creating a worker', async () => {
  const Worker = vi.fn(() => { throw new Error('Worker unavailable'); });
  vi.stubGlobal('Worker', Worker);
  const workspace = createWorkspace();
  const item = createItem('Ordinary task'); workspace.items[item.id] = item;
  expect(await reconcileOffMainThread(workspace, new Date())).toMatchObject({ created: [], updated: [], autoClosed: [] });
  expect(Worker).not.toHaveBeenCalled();
});
