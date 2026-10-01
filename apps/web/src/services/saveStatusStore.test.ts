import { expect, it, vi } from 'vitest';
import { createSaveStatusStore } from './saveStatusStore';

it('notifies only subscribers on real transitions and exposes current unsaved state synchronously', () => {
  const store = createSaveStatusStore();
  const seen: string[] = [];
  const stop = store.subscribe(() => { seen.push(store.getSnapshot()); });
  expect(store.getSnapshot()).toBe('loaded');
  store.set('saving'); store.set('saving'); store.set('error'); store.set('saving'); store.set('saved');
  expect(seen).toEqual(['saving', 'error', 'saving', 'saved']);
  stop(); store.set('loaded');
  expect(seen).toHaveLength(4);
  expect(store.getSnapshot()).toBe('loaded');
});

it('keeps controllers isolated and retains status without subscribers', () => {
  const first = createSaveStatusStore();
  const second = createSaveStatusStore();
  const listener = vi.fn();
  second.subscribe(listener);
  first.set('error');
  expect(listener).not.toHaveBeenCalled();
  expect(first.getSnapshot()).toBe('error');
  expect(second.getSnapshot()).toBe('loaded');
});
