import { useState } from 'react';
import { Button, Field, Input } from '../../components/ui/primitives';
import type { DavSettings } from '../../services/webdavSync';

export function WebDavEntry({ language, disabled, onOpen }: { language: string; disabled: boolean; onOpen: (settings: DavSettings, code: string, password: string) => Promise<void> }) {
  const ru = language === 'ru';
  const [draft, setDraft] = useState<DavSettings>(() => ({ url: '', folder: 'UniversalSync', username: '', password: '', syncPassword: '', deviceId: crypto.randomUUID(), enabled: true, logs: true }));
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <details className="webdav-entry settings-disclosure" translate="no"><summary>{ru ? 'Открыть через WebDAV' : 'Open from WebDAV'}</summary>
    <p>{ru ? 'Загрузите существующее рабочее пространство с вашего сервера. Код скопируйте в настройках WebDAV на первом устройстве после успешной синхронизации. Создание аккаунта на сервере не требуется.' : 'Download an existing workspace from your server. Copy its code from WebDAV settings on the first device after a successful sync. No new server account is created.'}</p>
    <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await onOpen(draft, code.trim(), password); } catch (reason) { const message = reason instanceof Error && /^webdav-[a-z0-9-]+$/.test(reason.message) ? reason.message : 'webdav-import-failed'; setError(`${ru ? 'Не удалось открыть. Проверьте подключение, код и пароли' : 'Could not open. Check connection, code and passwords'} (${message}).`); } finally { setBusy(false); } }}>
      <fieldset disabled={disabled || busy}>
        <Field label={ru ? 'Адрес WebDAV (HTTPS)' : 'WebDAV URL (HTTPS)'}><Input type="url" required value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} /></Field>
        <Field label={ru ? 'Папка внутри WebDAV' : 'Folder inside WebDAV'}><Input value={draft.folder} onChange={e => setDraft({ ...draft, folder: e.target.value })} /></Field>
        <Field label={ru ? 'Логин WebDAV' : 'WebDAV username'}><Input autoComplete="username" required value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} /></Field>
        <Field label={ru ? 'Пароль WebDAV' : 'WebDAV password'}><Input type="password" autoComplete="current-password" required value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} /></Field>
        <Field label={ru ? 'Код рабочего пространства' : 'Workspace code'}><Input required value={code} onChange={e => setCode(e.target.value)} /></Field>
        <Field label={ru ? 'Общий пароль синхронизации' : 'Shared sync password'}><Input type="password" minLength={10} required value={draft.syncPassword} onChange={e => setDraft({ ...draft, syncPassword: e.target.value })} /></Field>
        <Field label={ru ? 'Новый локальный пароль для этого устройства' : 'New local password for this device'}><Input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={e => setPassword(e.target.value)} /></Field>
        <p>{ru ? 'Локальный пароль защищает копию на этом устройстве. Он может отличаться от общего пароля синхронизации. Google потребуется подключить отдельно; настройки устройства останутся локальными. В браузере сервер должен поддерживать CORS.' : 'The local password protects this device’s copy and can differ from the shared sync password. Connect Google separately; device settings remain local. Browser access requires server CORS support.'}</p>
        <Button type="submit">{busy ? (ru ? 'Загрузка и сохранение…' : 'Downloading and saving…') : (ru ? 'Загрузить и открыть' : 'Download and open')}</Button>
      </fieldset>
    </form>
    {busy && <progress aria-label={ru ? 'Открытие WebDAV' : 'Opening WebDAV'} />}
    {error && <p role="alert">{error}</p>}
  </details>;
}
