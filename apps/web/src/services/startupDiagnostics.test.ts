import { beforeEach, describe, expect, it } from 'vitest';
import { beginStartup, clearStartupLog, failStartup, finishStartup, interruptedStartup, readStartupLog, STARTUP_DURABLE_PENDING_KEY, STARTUP_LOG_KEY, startupCheckpoint } from './startupDiagnostics';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

describe('durable startup checkpoints', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  });
  it('keeps fast checkpoints and detects an interrupted launch after session loss', () => {
    beginStartup('local');
    startupCheckpoint('load', 'started', { bytes: 120 });
    sessionStorage.clear();
    expect(interruptedStartup()).toBe(true);
    expect(readStartupLog().at(-1)).toMatchObject({ stage: 'load', phase: 'started', bytes: 120 });
    finishStartup();
    expect(interruptedStartup()).toBe(false);
  });
  it('retains failures and never clears another attempt marker', () => {
    beginStartup('safe'); failStartup();
    expect(interruptedStartup()).toBe(true);
    localStorage.setItem(STARTUP_DURABLE_PENDING_KEY, 'other-tab');
    finishStartup();
    expect(localStorage.getItem(STARTUP_DURABLE_PENDING_KEY)).toBe('other-tab');
  });
  it('exports only numeric technical metadata and bounds history', () => {
    beginStartup('backup');
    startupCheckpoint('load', 'completed', { bytes: NaN, items: 3, password: 'SECRET' } as { items: number });
    const record = readStartupLog().at(-1)!;
    localStorage.setItem(STARTUP_LOG_KEY, JSON.stringify([{ ...record, title: 'SECRET' }, { ...record, stage: 'SECRET' }]));
    expect(JSON.stringify(readStartupLog())).not.toContain('SECRET');
    expect(readStartupLog()).toHaveLength(1);
    for (let i = 0; i < 130; i++) startupCheckpoint('render', 'started');
    expect(readStartupLog()).toHaveLength(120);
    clearStartupLog();
    expect(readStartupLog()).toEqual([]);
    expect(interruptedStartup()).toBe(true);
  });
  it('does not block entry when browser storage fails', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } } });
    expect(() => { beginStartup('local'); startupCheckpoint('load', 'started'); finishStartup(); }).not.toThrow();
  });
  it('honors disabled diagnostics while keeping the content-free recovery marker', () => {
    localStorage.setItem('utm:diagnostics-enabled:v1', 'false');
    beginStartup('safe');
    expect(readStartupLog()).toEqual([]);
    expect(interruptedStartup()).toBe(true);
  });
});
