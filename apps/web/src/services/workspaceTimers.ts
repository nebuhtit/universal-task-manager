import type { WorkspaceDocument } from '@utm/core';

const MAX_TIMEOUT_MS = 2_147_000_000;

export function virtualDelayToRealMs(workspace: WorkspaceDocument, virtualDelayMs: number): number {
  if (!(virtualDelayMs > 0)) return 0;
  const clock = workspace.calendarPreferences.testClock;
  if (!clock?.enabled || !(clock.secondsPerDay > 0)) return Math.min(virtualDelayMs, MAX_TIMEOUT_MS);
  return Math.min(virtualDelayMs * clock.secondsPerDay / 86_400, MAX_TIMEOUT_MS);
}

export function scheduleWorkspaceTime(
  workspace: WorkspaceDocument,
  virtualDelayMs: number,
  callback: () => void,
): () => void {
  const timeout = globalThis.setTimeout(callback, Math.max(0, virtualDelayToRealMs(workspace, virtualDelayMs)));
  return () => globalThis.clearTimeout(timeout);
}

