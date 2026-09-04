import { exportEncryptedLocalBackup, installEncryptedLocalBackup } from '@utm/sdk';
import type { NativeReminderEntry } from './nativeReminders';

type HostMessage =
  | { type: 'utm-obsidian:workspace'; source?: string }
  | { type: 'utm-obsidian:saved'; id: string; ok: boolean; error?: string }
  | { type: 'utm-obsidian:flush'; id: string }
  | { type: 'utm-obsidian:open-item'; itemId: string };

const enabled = () => import.meta.env.VITE_OBSIDIAN === 'true' && window.parent !== window;
const pending = new Map<string, { resolve: () => void; reject: (reason: Error) => void }>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
    if (event.source !== window.parent || !event.data?.type) return;
    if (event.data.type === 'utm-obsidian:saved') {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      event.data.ok ? request.resolve() : request.reject(new Error(event.data.error || 'Obsidian vault save failed'));
    } else if (event.data.type === 'utm-obsidian:flush') {
      window.dispatchEvent(new CustomEvent('utm-obsidian-flush', { detail: { id: event.data.id } }));
    } else if (event.data.type === 'utm-obsidian:open-item') {
      window.dispatchEvent(new CustomEvent('utm-open-item', { detail: { itemId: event.data.itemId } }));
    }
  });
}

export async function bootstrapObsidianWorkspace(): Promise<void> {
  if (!enabled()) return;
  listen();
  const source = await new Promise<string | undefined>((resolve) => {
    const timeout = window.setTimeout(() => resolve(undefined), 2_000);
    const receiver = (event: MessageEvent<HostMessage>) => {
      if (event.source !== window.parent || event.data?.type !== 'utm-obsidian:workspace') return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', receiver);
      resolve(event.data.source);
    };
    window.addEventListener('message', receiver);
    window.parent.postMessage({ type: 'utm-obsidian:ready' }, '*');
  });
  if (source) await installEncryptedLocalBackup(source);
}

export async function persistObsidianWorkspace(): Promise<void> {
  if (!enabled()) return;
  listen();
  const source = await exportEncryptedLocalBackup();
  const id = `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const completion = new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
  window.parent.postMessage({ type: 'utm-obsidian:save', id, source }, '*');
  await completion;
}

export function syncObsidianReminders(entries: NativeReminderEntry[]): void {
  if (!enabled()) return;
  window.parent.postMessage({ type: 'utm-obsidian:reminders', entries }, '*');
}

export function acknowledgeObsidianFlush(id: string, error?: string): void {
  if (!enabled()) return;
  window.parent.postMessage({ type: 'utm-obsidian:flushed', id, ok: !error, ...(error ? { error } : {}) }, '*');
}
