import { useEffect, useState } from 'react';
import { enableFaceIdUnlock, faceIdStatus } from '@utm/sdk';
import type { WorkspaceDocument } from '@utm/core';
import type { AppNotice } from '../../components/layout/AppShell';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button } from '../../components/ui/primitives';
import { diagnosticFailureCode, recordDiagnostic } from '../../services/diagnostics';
import { setFaceIdConfiguredHint } from '../../services/faceIdHint';
import { isNativeReminderAvailable, nativeReminderPermissionStatus, requestNativeReminderPermission, syncNativeReminders } from '../../services/nativeReminders';

type Action = 'face-id' | 'notifications';
type Decisions = Partial<Record<Action, 'pending' | 'declined' | 'done'>>;
export const DEVICE_SETUP_KEY = 'utm:device-setup:v1';

export function readDeviceSetup(): Decisions {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_SETUP_KEY) ?? '{}');
    return Object.fromEntries((['face-id', 'notifications'] as const).flatMap(key =>
      ['pending', 'declined', 'done'].includes(value?.[key]) ? [[key, value[key]]] : []));
  } catch { return {}; }
}

export function useDeviceSetupNotices(workspace: WorkspaceDocument | undefined, storageMode: 'encrypted' | 'plaintext' | undefined, getDataKey: () => Uint8Array | null, onFaceIdEnabled: () => void) {
  const [decisions, setDecisions] = useState<Decisions>(readDeviceSetup);
  const [eligible, setEligible] = useState<Action[]>([]);
  const [selected, setSelected] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [at] = useState(() => new Date().toISOString());
  const ru = workspace?.calendarPreferences.language === 'ru';
  const remember = (action: Action, value: NonNullable<Decisions[Action]>, onlyIfUnset = false) => setDecisions(previous => {
    if ((onlyIfUnset && previous[action]) || previous[action] === value) return previous;
    const next = { ...previous, [action]: value };
    try { localStorage.setItem(DEVICE_SETUP_KEY, JSON.stringify(next)); }
    catch { recordDiagnostic({ kind: 'error', operation: 'Device setup prompts', message: 'Could not retain device setup choice', details: 'browser-storage' }); }
    return next;
  });
  useEffect(() => {
    if (!workspace) { setEligible([]); setSelected(null); return; }
    let disposed = false;
    const check = async () => {
      const available: Action[] = [];
      if (storageMode !== 'plaintext') {
        try {
          const status = await faceIdStatus();
          if (disposed) return;
          if (status === 'available') available.push('face-id');
          if (status === 'configured') remember('face-id', 'done');
        } catch { recordDiagnostic({ kind: 'error', operation: 'Device setup prompts', message: 'Could not check biometric availability' }); }
      }
      try {
        const status = isNativeReminderAvailable() ? (await nativeReminderPermissionStatus()).authorization
          : 'Notification' in window ? Notification.permission : undefined;
        if (disposed) return;
        if (status === 'granted') remember('notifications', 'done');
        else if (status && status !== 'unknown') available.push('notifications');
      } catch { recordDiagnostic({ kind: 'error', operation: 'Device setup prompts', message: 'Could not check local notification permission' }); }
      if (disposed) return;
      setEligible(available);
      for (const action of available) remember(action, 'pending', true);
    };
    void check();
    const foreground = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', foreground);
    return () => { disposed = true; document.removeEventListener('visibilitychange', foreground); };
  }, [workspace?.workspaceId, storageMode]);

  const notices: AppNotice[] = eligible.filter(action => decisions[action] === 'pending').map(action => ({
    id: `device-setup:${action}`, setupAction: action, at,
    title: action === 'face-id' ? (ru ? 'Включить Face ID / Touch ID?' : 'Enable Face ID / Touch ID?')
      : (ru ? 'Включить локальные уведомления?' : 'Enable local notifications?'),
    body: action === 'face-id' ? (ru ? 'Быстрое открытие рабочего пространства на этом устройстве.' : 'Open your workspace quickly on this device.')
      : (ru ? 'Получайте напоминания о событиях и задачах.' : 'Receive reminders for your events and tasks.'),
  }));
  const close = () => { if (!busy) { setSelected(null); setError(''); } };
  const enable = async () => {
    if (!selected || !workspace) return;
    setBusy(true); setError('');
    try {
      if (selected === 'face-id') {
        const key = getDataKey();
        if (!key?.length) throw new Error('Workspace is locked');
        await enableFaceIdUnlock(key);
        setFaceIdConfiguredHint(true);
        onFaceIdEnabled();
      } else {
        const permission = isNativeReminderAvailable() ? (await requestNativeReminderPermission()).authorization : await Notification.requestPermission();
        remember(selected, permission === 'granted' ? 'done' : 'declined');
        if (permission !== 'granted') {
          setError(ru ? 'Уведомления не разрешены. Их можно включить в настройках устройства или браузера.' : 'Notifications are not allowed. You can enable them in device or browser settings.');
          return;
        }
        await syncNativeRemindersIfAvailable(workspace);
      }
      remember(selected, 'done'); setSelected(null);
    } catch (reason) {
      recordDiagnostic({ kind: 'error', operation: 'Device setup prompts', message: 'Device setup action failed', details: diagnosticFailureCode(reason) });
      setError(ru ? 'Не удалось включить. Можно повторить или сделать это позже в настройках.' : 'Could not enable this feature. Retry or enable it later in Settings.');
    } finally { setBusy(false); }
  };
  return {
    notices,
    open(notice: AppNotice) {
      if (!notice.setupAction) return false;
      setSelected(notice.setupAction); setError(''); return true;
    },
    dismiss(id: string) {
      const action = (['face-id', 'notifications'] as const).find(value => id === `device-setup:${value}`);
      if (!action) return false;
      remember(action, 'declined'); return true;
    },
    dialog: <ResponsiveDialog open={selected !== null} onOpenChange={open => { if (!open) close(); }}
      title={selected === 'face-id' ? (ru ? 'Включить Face ID / Touch ID?' : 'Enable Face ID / Touch ID?') : (ru ? 'Включить локальные уведомления?' : 'Enable local notifications?')}
      closeLabel={ru ? 'Закрыть' : 'Close'}
      footer={<><Button disabled={busy} onClick={() => { if (selected) remember(selected, 'declined'); close(); }}>{ru ? 'Не включать' : 'Decline'}</Button><Button variant="primary" disabled={busy} onClick={() => void enable()}>{busy ? (ru ? 'Включение…' : 'Enabling…') : (ru ? 'Включить' : 'Enable')}</Button></>}>
      <p>{selected === 'face-id' ? (ru ? 'Подтвердите включение быстрого входа на этом устройстве. Пароль останется доступен для восстановления.' : 'Confirm quick unlock on this device. Your password remains available for recovery.')
        : (ru ? 'После подтверждения устройство попросит разрешение показывать напоминания.' : 'After confirmation, your device will ask permission to show reminders.')}</p>
      {error && <p role="alert">{error}</p>}
    </ResponsiveDialog>,
  };
}

async function syncNativeRemindersIfAvailable(workspace: WorkspaceDocument) {
  if (isNativeReminderAvailable()) await syncNativeReminders(workspace);
}
