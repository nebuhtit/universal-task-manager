/// <reference lib="webworker" />
import { calculateGoogleSyncPlan, type GoogleSyncPlanInput } from './services/googleSyncPlan';
self.onmessage = (event: MessageEvent<GoogleSyncPlanInput>) => {
  try { self.postMessage({ ok: true, patches: calculateGoogleSyncPlan(event.data) }); }
  catch { self.postMessage({ ok: false }); }
};
