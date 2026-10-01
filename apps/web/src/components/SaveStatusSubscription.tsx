import { useSyncExternalStore, type ReactNode } from 'react';
import type { SaveStatus, SaveStatusStore } from '../services/saveStatusStore';

/** Subscribe only the small status displays, not the page/controller tree. */
export function SaveStatusSubscription({ store, children }: {
  store: SaveStatusStore;
  children: (status: SaveStatus) => ReactNode;
}) {
  const status = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return children(status);
}
