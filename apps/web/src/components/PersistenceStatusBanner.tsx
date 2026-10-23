import { useEffect, useState, useSyncExternalStore } from 'react';
import type { UniversalItem } from '@utm/core';
import type { SaveStatusStore } from '../services/saveStatusStore';
import { writeClipboardText } from '../services/clipboard';
import { Button } from './ui/primitives';

export function PersistenceStatusBanner({ store, retry, getUnsavedItems, language, inline = false }: { store: SaveStatusStore; retry: () => Promise<void>; getUnsavedItems: () => UniversalItem[]; language: string; inline?: boolean }) {
  const status = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { setMessage(''); }, [status]);
  const ru = language === 'ru';
  if (status !== 'saving' && status !== 'error') return null;
  const copy = async () => {
    try {
      const items = getUnsavedItems();
      if (!items.length) { setMessage(ru ? 'Изменённых items нет. Другие настройки могут оставаться несохранёнными.' : 'No changed items. Other settings may still be unsaved.'); return; }
      await writeClipboardText(JSON.stringify(items.length === 1 ? items[0] : items, null, 2));
      setMessage(ru ? `JSON скопирован (${items.length}). Вставьте его в заметку до закрытия приложения.` : `JSON copied (${items.length}). Paste it into a note before closing the app.`);
    } catch { setMessage(ru ? 'Копирование не удалось. Откройте item → JSON и скопируйте текст вручную.' : 'Copy failed. Open item → JSON and copy the text manually.'); }
  };
  return <section className={`save-status-banner${inline ? ' save-status-inline' : ''}${status === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite" data-testid={inline ? 'editor-save-status' : 'save-status'}>
    <div>{status === 'saving' ? (ru ? 'Сохранение… Не закрывайте приложение.' : 'Saving… Do not close the app.') : (ru ? 'Не сохранено. Последние изменения пока только в памяти.' : 'Not saved. Latest changes are only in memory.')}</div>
    {status === 'error' && <div>{ru ? 'Карточки видны, но могут пропасть после перезапуска. Скопируйте JSON.' : 'Visible cards may disappear after restart. Copy their JSON.'}</div>}
    {status === 'error' && <Button size="compact" disabled={busy} onClick={async () => { setBusy(true); setMessage(''); try { await retry(); } catch { setMessage(ru ? 'Повтор не помог. Скопируйте JSON перед закрытием.' : 'Retry failed. Copy the JSON before closing.'); } finally { setBusy(false); } }}>{busy ? (ru ? 'Повтор…' : 'Retrying…') : (ru ? 'Повторить сохранение' : 'Retry saving')}</Button>}
    <Button size="compact" onClick={() => void copy()}>{ru ? 'Скопировать JSON несохранённых items' : 'Copy unsaved items JSON'}</Button>
    {message && <div>{message}</div>}
  </section>;
}
