import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('timer alarm recovery', () => {
  it('resumes interrupted audio, retries on return, and removes recovery after stop', async () => {
    const param = () => ({ setValueAtTime: vi.fn() });
    const nodes: Array<{ stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
    const resume = vi.fn().mockResolvedValue(undefined);
    class Context {
      state = 'interrupted'; currentTime = 0; destination = {};
      resume = resume;
      createOscillator() {
        const node = { type: '', frequency: param(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: (target: unknown) => target };
        nodes.push(node); return node;
      }
      createGain() { return { gain: param(), disconnect: vi.fn(), connect: (target: unknown) => target }; }
    }
    const windowTarget = Object.assign(new EventTarget(), { AudioContext: Context });
    const documentTarget = new EventTarget();
    vi.stubGlobal('window', windowTarget); vi.stubGlobal('document', documentTarget);
    const { startTimerAlarm } = await import('./useUiSounds');
    const stop = startTimerAlarm();
    expect(resume).toHaveBeenCalledTimes(1);
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    windowTarget.dispatchEvent(new Event('pointerdown'));
    expect(resume).toHaveBeenCalledTimes(3);
    stop(); stop();
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(resume).toHaveBeenCalledTimes(3);
    for (const node of nodes) { expect(node.stop).toHaveBeenCalledTimes(1); expect(node.disconnect).toHaveBeenCalledTimes(1); }
  });
});
