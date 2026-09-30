import type { WorkspaceDocument } from '@utm/core';
import { syncTrace } from './syncTrace';
import { type GoogleSyncPlanInput, type GoogleSyncPatch } from './googleSyncPlan';
import { currentProfileActionId, recordWorkerProfileSpan } from './performanceProfile';

export const yieldGoogleSync = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** Copy document-owned values in slices so scrolling/taps get processing time. */
export async function googleSyncSnapshot(workspace: WorkspaceDocument): Promise<WorkspaceDocument> {
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(workspace)) {
    if (['items', 'views', 'tombstones'].includes(key)) {
      const entries: Record<string, unknown> = {}; let started = performance.now();
      for (const id of Object.keys(value)) {
        entries[id] = JSON.parse(JSON.stringify((value as Record<string, unknown>)[id]));
        if (performance.now() - started >= 8) { await yieldGoogleSync(); started = performance.now(); }
      }
      snapshot[key] = entries;
    } else snapshot[key] = JSON.parse(JSON.stringify(value));
    await yieldGoogleSync();
  }
  return snapshot as unknown as WorkspaceDocument;
}

export async function planGoogleSync(input: GoogleSyncPlanInput, actionId: number | null = currentProfileActionId() ?? null): Promise<GoogleSyncPatch[]> {
  // No synchronous fallback: it would reintroduce the device freeze.
  if (typeof Worker === 'undefined') throw new Error('Google sync worker is unavailable. Nothing was imported.');
  const worker = new Worker(new URL('../googleSync.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<GoogleSyncPatch[]>((resolve, reject) => {
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Google sync calculation timed out. Nothing was imported.')); }, 30_000);
      worker.onmessage = (event: MessageEvent<{ ok: boolean; patches: GoogleSyncPatch[]; durationMs?: number }>) => {
        clearTimeout(timeout);
        if (event.data.durationMs !== undefined) recordWorkerProfileSpan('google.worker-work', event.data.durationMs, { recalculated: event.data.patches?.length ?? 0 }, actionId);
        if (event.data.ok) resolve(event.data.patches); else reject(new Error('Google sync calculation failed. Nothing was imported.'));
      };
      worker.onerror = () => { clearTimeout(timeout); reject(new Error('Google sync worker failed. Nothing was imported.')); };
      try { syncTrace('worker-post-start', { items: Object.keys(input.workspace.items).length }); worker.postMessage(input); syncTrace('worker-post-end'); } catch (error) { clearTimeout(timeout); reject(error); }
    });
  } finally { worker.terminate(); }
}
