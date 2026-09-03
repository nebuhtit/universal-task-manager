import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { effectiveWorkspaceNow, type WorkspaceDocument } from '@utm/core';
import { clockService } from '../services/clockService';

export function useClockMilliseconds(cadenceMs = 1_000, enabled = true): number {
  const frozenSnapshot = useRef(clockService.getSnapshot());
  const subscribe = useCallback((listener: () => void) => enabled ? clockService.subscribe(listener, cadenceMs) : () => undefined, [cadenceMs, enabled]);
  const liveSnapshot = useSyncExternalStore(subscribe, clockService.getSnapshot, clockService.getSnapshot);
  return enabled ? liveSnapshot : frozenSnapshot.current;
}

export function useWorkspaceNow(workspace: WorkspaceDocument | undefined, cadenceMs = 1_000, enabled = true): Date {
  const milliseconds = useClockMilliseconds(cadenceMs, enabled);
  return useMemo(() => workspace ? effectiveWorkspaceNow(workspace, new Date(milliseconds)) : new Date(milliseconds), [milliseconds, workspace]);
}
