import { expect, it, vi } from 'vitest';
import { writeNativeICloudBackup } from './nativeICloudBackup';

it('exports exact Unicode bytes to Files and waits for native completion', async () => {
  const events = new EventTarget();
  const messages: Array<{ id: string; kind: string; value?: string; byteLength?: number; destination?: string }> = [];
  vi.stubGlobal('window', Object.assign(events, { webkit: { messageHandlers: { utmNativeBackup: { postMessage(message: typeof messages[number]) { messages.push(message); } } } } }));
  try {
    const source = 'a'.repeat(47_999) + '🍏' + 'б'.repeat(48_000);
    let completed = false;
    const result = writeNativeICloudBackup(source, 'test.utmb', 'files').then(() => { completed = true; });
    expect(messages[0]?.destination).toBe('files');
    const chunks = messages.filter(message => message.kind === 'backup.chunk').map(message => message.value!);
    expect(chunks.join('')).toBe(source);
    expect(chunks.reduce((total, value) => total + new TextEncoder().encode(value).length, 0)).toBe(messages[0]!.byteLength);
    expect(completed).toBe(false);
    events.dispatchEvent(new CustomEvent('utm-native-backup-status', { detail: { id: messages[0]!.id, ok: true } }));
    await result;
    expect(completed).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
