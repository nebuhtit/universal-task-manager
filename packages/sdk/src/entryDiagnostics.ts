export type EntryStage = 'decrypt' | 'load' | 'storage-preparation';
export type EntryProgress = { stage: EntryStage; phase: 'started' | 'completed'; bytes?: number };
let observer: ((progress: EntryProgress) => void) | undefined;

/** Optional technical telemetry; never include document content or keys. */
export function setEntryProgressObserver(next: (progress: EntryProgress) => void): void { observer = next; }
export function entryProgress(progress: EntryProgress): void {
  try { observer?.(progress); } catch { /* Diagnostics cannot block entry. */ }
}
