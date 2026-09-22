let release: (() => void) | undefined;
let acquiring: Promise<void> | undefined;

/** One editable session per browser origin. A second tab can use safe preview. */
export function acquireWorkspaceWriter(): Promise<void> {
  if (release) return Promise.resolve();
  if (acquiring) return acquiring;
  acquiring = new Promise<void>((resolve, reject) => {
    if (!navigator.locks) { reject(new Error('This browser cannot protect concurrent workspace writes. Use a current browser or safe read-only opening.')); return; }
    void navigator.locks.request('utm-workspace-writer-v1', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) { reject(new Error('Workspace is open for editing in another tab. Close or lock that tab, then retry; safe read-only opening is available.')); return; }
      await new Promise<void>((done) => { release = done; resolve(); });
    }).catch(reject);
  }).finally(() => { acquiring = undefined; });
  return acquiring;
}

export function releaseWorkspaceWriter(): void { const done = release; release = undefined; done?.(); }

export const PENDING_SAVE_KEY = 'utm:pending-save:v1';
export function markPendingSave(): void { try { localStorage.setItem(PENDING_SAVE_KEY, new Date().toISOString()); } catch { /* Best effort, UI still reports failure. */ } }
export function clearPendingSave(): void { try { localStorage.removeItem(PENDING_SAVE_KEY); } catch { /* Best effort. */ } }
