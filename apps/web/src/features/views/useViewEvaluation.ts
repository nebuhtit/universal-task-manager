import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { effectiveWorkspaceNow, type SavedView, type WorkspaceDocument } from '@utm/core';
import { clockService } from '../../services/clockService';
import { getWorkspaceIndex } from '../../services/workspaceIndex';
import { completionHoldsSnapshot, evaluateView, subscribeCompletionHolds, viewContinuouslyDependsOnCurrentTime, viewDependsOnCurrentTime } from './viewSelectors';

function crossedBoundaryCount(boundaries: number[], now: number): number {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (boundaries[middle]! <= now) low = middle + 1;
    else high = middle;
  }
  return low;
}

function localDateKey(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return now.toISOString().slice(0, 10); }
}

export function temporalEvaluationKey(boundaries: number[], now: Date, timeZone: string, continuous: boolean): string {
  const date = localDateKey(now, timeZone);
  const utcDate = now.toISOString().slice(0, 10);
  const boundary = `${crossedBoundaryCount(boundaries, now.getTime())}:${crossedBoundaryCount(boundaries, now.getTime() - 1)}`;
  return continuous ? `${date}:${utcDate}:${boundary}:${Math.floor(now.getTime() / 1_000)}` : `${date}:${utcDate}:${boundary}`;
}

/**
 * A central clock still checks time once per second, but React only receives a
 * changed snapshot when this View can produce a different result.
 */
function useTemporalNow(workspace: WorkspaceDocument, dependsOnTime: boolean, continuous: boolean, identity: unknown, suppliedNow?: Date, extraBoundaries?: readonly number[]): Date {
  const boundaries = useMemo(() => [...getWorkspaceIndex(workspace).workspaceBoundaries, ...(extraBoundaries ?? [])].sort((a, b) => a - b), [workspace, extraBoundaries]);
  const frozenNow = useMemo(() => suppliedNow ?? effectiveWorkspaceNow(workspace, clockService.now()), [identity, suppliedNow, workspace]);
  const snapshot = useCallback(() => {
    if (!dependsOnTime) return 'static';
    const now = effectiveWorkspaceNow(workspace, new Date(clockService.getSnapshot()));
    // Both sides matter: Due uses < now, while Event opens uses <= now.
    return temporalEvaluationKey(boundaries, now, workspace.calendarPreferences.timezone, continuous);
  }, [boundaries, continuous, dependsOnTime, workspace]);
  const subscribe = useCallback((listener: () => void) => dependsOnTime ? clockService.subscribe(listener, 1_000) : () => undefined, [dependsOnTime]);
  const key = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => suppliedNow ?? (dependsOnTime ? effectiveWorkspaceNow(workspace, new Date(clockService.getSnapshot())) : frozenNow), [dependsOnTime, frozenNow, key, suppliedNow, workspace]);
}

export function useViewNow(workspace: WorkspaceDocument, view: SavedView, suppliedNow?: Date): Date {
  const dependsOnTime = useMemo(() => suppliedNow === undefined && viewDependsOnCurrentTime(workspace, view), [suppliedNow, view, workspace]);
  const continuous = useMemo(() => dependsOnTime && viewContinuouslyDependsOnCurrentTime(workspace, view), [dependsOnTime, view, workspace]);
  return useTemporalNow(workspace, dependsOnTime, continuous, view, suppliedNow);
}

/** Calendar membership always depends on midnight/overdue, even with a static filter. */
export function useCalendarNow(workspace: WorkspaceDocument, view: SavedView, projectedBoundaries: readonly number[], suppliedNow?: Date): Date {
  const continuous = useMemo(() => viewContinuouslyDependsOnCurrentTime(workspace, view), [workspace, view]);
  return useTemporalNow(workspace, true, continuous, view, suppliedNow, projectedBoundaries);
}

/** Updates generic workspace screens only at a local/UTC day or item time boundary. */
export function useWorkspaceBoundaryNow(workspace: WorkspaceDocument, suppliedNow?: Date): Date {
  return useTemporalNow(workspace, suppliedNow === undefined, false, workspace, suppliedNow);
}

export function useViewEvaluation(workspace: WorkspaceDocument, view: SavedView) {
  const now = useViewNow(workspace, view);
  const completionVersion = useSyncExternalStore(subscribeCompletionHolds, completionHoldsSnapshot, completionHoldsSnapshot);
  return useMemo(() => evaluateView(workspace, view, now), [completionVersion, now, view, workspace]);
}
