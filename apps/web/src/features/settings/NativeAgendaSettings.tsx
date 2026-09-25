import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/primitives';
import { agendaWidgetRequest, hasNativeAgendaWidget } from '../../services/nativeAgendaWidget';

export function NativeAgendaSettings({ ru }: { ru: boolean }) {
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (hasNativeAgendaWidget()) void agendaWidgetRequest('status').then(value => setEnabled(value.enabled)).catch(() => setError(ru ? 'Общее хранилище виджета недоступно. Проверьте App Groups в Xcode.' : 'Widget storage unavailable. Check App Groups in Xcode.')); }, [ru]);
  if (!hasNativeAgendaWidget()) return null;
  const change = async () => {
    setBusy(true); setError('');
    try {
      const value = await agendaWidgetRequest(enabled ? 'disable' : 'enable');
      setEnabled(value.enabled); window.dispatchEvent(new Event('utm-agenda-widget-change'));
    } catch { setError(ru ? 'Не удалось настроить виджет. Проверьте App Groups и подпись обоих targets в Xcode.' : 'Could not configure widget. Check App Groups and signing for both targets in Xcode.'); }
    finally { setBusy(false); }
  };
  return <details className="settings-disclosure"><summary>{ru ? 'Виджет экрана блокировки' : 'Lock Screen widget'}</summary><section className="settings-card">
    <h2>{ru ? 'Сейчас и далее' : 'Now and next'}</h2>
    <div>{ru ? 'Передавать названия и время событий в локальный виджет. Они будут видны на заблокированном iPhone и сохранятся вне зашифрованного рабочего пространства. Сервер не используется.' : 'Share event titles and times with the local widget. They will be visible on the locked iPhone and stored outside the encrypted workspace. No server is used.'}</div>
    <Button disabled={busy} onClick={() => void change()}>{enabled ? (ru ? 'Отключить и очистить' : 'Disable and clear') : (ru ? 'Включить виджет' : 'Enable widget')}</Button>
    <div>{ru ? 'После включения: удерживайте экран блокировки → Настроить → Добавить виджеты → Universal. План готовится на 48 часов; открывайте приложение для обновления. iOS управляет временем переключения записей.' : 'Then hold the Lock Screen → Customize → Add Widgets → Universal. The schedule covers 48 hours; open the app to refresh. iOS controls entry transition timing.'}</div>
    {error && <div role="alert">{error}</div>}
  </section></details>;
}
