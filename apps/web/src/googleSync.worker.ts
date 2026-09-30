/// <reference lib="webworker" />
import { calculateGoogleSyncPlan, type GoogleSyncPlanInput } from './services/googleSyncPlan';
self.onmessage = (event: MessageEvent<GoogleSyncPlanInput>) => {
  const startedAt = performance.now();
  try { const patches = calculateGoogleSyncPlan(event.data); self.postMessage({ ok: true, patches, durationMs: performance.now() - startedAt }); }
  catch { self.postMessage({ ok: false, durationMs: performance.now() - startedAt }); }
};
