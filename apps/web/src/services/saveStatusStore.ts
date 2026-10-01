export type SaveStatus = 'loaded' | 'saving' | 'saved' | 'error';

/** Controller-local UI signal; never stores workspace data or drives persistence. */
export function createSaveStatusStore() {
  let status: SaveStatus = 'loaded';
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: SaveStatus) {
      if (next === status) return;
      status = next;
      listeners.forEach(listener => listener());
    },
  };
}
export type SaveStatusStore = ReturnType<typeof createSaveStatusStore>;
