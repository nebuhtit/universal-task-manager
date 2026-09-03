type ClockSubscription = { listener: () => void; cadenceMs: number; bucket: number };

const subscriptions = new Set<ClockSubscription>();
let snapshot = Date.now();
let timer: ReturnType<typeof setTimeout> | undefined;
let timerCadence = 0;

function stopTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  timerCadence = 0;
}

function emitDueSubscribers() {
  snapshot = Date.now();
  for (const subscription of subscriptions) {
    const bucket = Math.floor(snapshot / subscription.cadenceMs);
    if (bucket === subscription.bucket) continue;
    subscription.bucket = bucket;
    subscription.listener();
  }
}

function scheduleTimer() {
  const cadence = Math.min(...[...subscriptions].map((subscription) => subscription.cadenceMs));
  if (!Number.isFinite(cadence)) { stopTimer(); return; }
  if (timer !== undefined && timerCadence === cadence) return;
  stopTimer();
  timerCadence = cadence;
  // Align the next notification to the requested cadence. This avoids a
  // drifting interval and makes a foregrounded iOS PWA refresh immediately.
  const delay = Math.max(1, cadence - (Date.now() % cadence));
  timer = setTimeout(() => {
    timer = undefined;
    timerCadence = 0;
    emitDueSubscribers();
    scheduleTimer();
  }, delay);
}

function refreshAfterForeground() {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    emitDueSubscribers();
    scheduleTimer();
  }
}

/** One scheduler for visible clocks, live Views, reminders and timed appearance. */
export const clockService = {
  getSnapshot: () => snapshot,
  now: () => new Date(Date.now()),
  subscribe(listener: () => void, cadenceMs = 1_000) {
    snapshot = Date.now();
    const normalizedCadence = Math.max(100, Math.floor(cadenceMs));
    const subscription: ClockSubscription = { listener, cadenceMs: normalizedCadence, bucket: Math.floor(snapshot / normalizedCadence) };
    subscriptions.add(subscription);
    if (subscriptions.size === 1 && typeof document !== 'undefined') document.addEventListener('visibilitychange', refreshAfterForeground);
    scheduleTimer();
    return () => {
      subscriptions.delete(subscription);
      if (subscriptions.size === 0 && typeof document !== 'undefined') document.removeEventListener('visibilitychange', refreshAfterForeground);
      scheduleTimer();
    };
  },
};
