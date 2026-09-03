type NativeMessage = { id: string; kind: 'backup.begin' | 'backup.chunk' | 'backup.end' | 'backup.import'; [key: string]: unknown };
type NativeStatus = { id: string; ok: boolean; error?: string };

const handlerName = 'utmNativeBackup';
const chunkSize = 48_000;
const pending = new Map<string, { resolve: () => void; reject: (reason: Error) => void }>();
let listening = false;

declare global {
  interface Window {
    webkit?: { messageHandlers?: Record<string, { postMessage(message: NativeMessage): void }> };
    __utmNativeBackupReceive?: (message: { kind: 'begin' | 'chunk' | 'end'; id: string; fileName?: string; value?: string }) => void;
  }
}

const handler = () => window.webkit?.messageHandlers?.[handlerName];
const newId = () => `icloud-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const isNativeICloudBackupAvailable = () => Boolean(handler());

function setupListeners() {
  if (listening) return;
  listening = true;
  let imported: { id: string; fileName: string; chunks: string[] } | undefined;
  window.addEventListener('utm-native-backup-status', ((event: CustomEvent<NativeStatus>) => {
    const request = pending.get(event.detail?.id);
    if (!request) return;
    pending.delete(event.detail.id);
    if (event.detail.ok) request.resolve();
    else request.reject(new Error(event.detail.error || 'iCloud backup failed'));
  }) as EventListener);
  window.__utmNativeBackupReceive = (message) => {
    if (message.kind === 'begin') { imported = { id: message.id, fileName: message.fileName || 'universal-backup.utmb', chunks: [] }; return; }
    if (!imported || imported.id !== message.id) return;
    if (message.kind === 'chunk') { imported.chunks.push(message.value || ''); return; }
    if (message.kind === 'end') {
      window.dispatchEvent(new CustomEvent('utm-native-backup-import', { detail: { source: imported.chunks.join(''), fileName: imported.fileName } }));
      imported = undefined;
    }
  };
}

export async function writeNativeICloudBackup(source: string, fileName: string): Promise<void> {
  const target = handler();
  if (!target) throw new Error('iCloud backup is available only in the Universal iOS app');
  setupListeners();
  const id = newId();
  const completion = new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
  target.postMessage({ id, kind: 'backup.begin', fileName, byteLength: new TextEncoder().encode(source).byteLength });
  for (let offset = 0, index = 0; offset < source.length; offset += chunkSize, index += 1) target.postMessage({ id, kind: 'backup.chunk', index, value: source.slice(offset, offset + chunkSize) });
  target.postMessage({ id, kind: 'backup.end' });
  return completion;
}

export function requestNativeICloudImport(): void {
  const target = handler();
  if (!target) throw new Error('Import from Files is available only in the Universal iOS app');
  setupListeners();
  target.postMessage({ id: newId(), kind: 'backup.import' });
}
