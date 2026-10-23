import { useState } from 'react';
import { Button, Field, Input } from '../../components/ui/primitives';
import type { DavSettings } from '../../services/webdavSync';
import { auditDav, setDavDiagnosticsEnabled } from '../../services/webdavDiagnostics';
import { recordDiagnostic } from '../../services/diagnostics';
import { defaultDavProxy, hasNativeWebDAV } from '../../services/webdavTransport';

export type WebDavEntryStage = 'requesting-file' | 'checking-sync-password' | 'saving-local';
const DEFAULT_DAV_FOLDER = 'UniversalSync';

function connectionFromAddress(settings: DavSettings): DavSettings {
  const address = new URL(settings.url.trim());
  const path = address.pathname.replace(/\/+$/, '');
  // A server endpoint (root, /webdav, or a URL explicitly ending in /) uses
  // the app-managed folder. A path appended without a trailing slash is an
  // explicit folder override.
  const useDefaultFolder = !path || settings.url.trim().endsWith('/') || /\/(?:webdav|dav)$/i.test(path);
  return { ...settings, url: address.href, folder: useDefaultFolder ? DEFAULT_DAV_FOLDER : '' };
}

const stageLabel = (stage: WebDavEntryStage | null, ru: boolean) => {
  if (stage === 'requesting-file') return ru ? 'Проверяем доступ и ищем файл рабочего пространства…' : 'Checking access and locating the workspace file…';
  if (stage === 'checking-sync-password') return ru ? 'Файл найден. Проверяем общий пароль и целостность…' : 'File found. Checking the shared password and file integrity…';
  if (stage === 'saving-local') return ru ? 'Данные проверены. Сохраняем на этом устройстве…' : 'Data verified. Saving on this device…';
  return '';
};

const openError = (reason: unknown, stage: WebDavEntryStage | null, ru: boolean) => {
  const code = reason instanceof Error ? reason.message : '';
  const messages: Record<string, string> = ru ? {
    'webdav-invalid-workspace-code': 'Код рабочего пространства должен быть UUID из настроек WebDAV на уже подключённом устройстве.',
    'webdav-https-required': 'Адрес должен начинаться с https:// и не содержать логин, пароль или параметры после знака ?.',
    'webdav-invalid-folder': 'Путь к папке некорректен. Уберите сегменты «.» и «..» и проверьте слеши.',
    'webdav-invalid-username': 'Логин WebDAV не может содержать двоеточие.',
    'webdav-network-or-cors': 'Сбой на этапе запроса к серверу: браузер не получил доступный ответ. Это может быть сеть, SSL или CORS; браузер не позволяет различить их точнее. Проверьте адрес и попробуйте ту же ссылку в Safari.',
    'webdav-network': 'Сбой сетевого запроса или SSL-сертификата WebDAV.',
    'webdav-timeout': 'Сервер не ответил вовремя. Проверьте доступность адреса и попробуйте ещё раз.',
    'webdav-access-denied': 'Сервер отклонил WebDAV-доступ (401). Проверьте имя пользователя и пароль WebDAV.',
    'webdav-forbidden': 'Сервер запретил доступ (403). Учётные данные приняты не полностью либо пользователю не выданы права на эту папку.',
    'webdav-http-404': 'Сервер ответил, но файл не найден (404). Проверьте полный адрес папки и код рабочего пространства.',
    'webdav-password-or-damaged-file': 'Файл найден и скачан, но общий пароль синхронизации не подошёл либо файл повреждён. Эти случаи криптографически неразличимы; локальные данные не заменены.',
    'webdav-protocol-version': 'Файл использует неподдерживаемую версию протокола. Обновите приложение; данные не импортированы.',
    'webdav-schema-version': 'Версии формата не совпадают. Обновите приложение на обоих устройствах; данные не импортированы.',
    'webdav-wrong-workspace': 'Код указывает на другое рабочее пространство. Проверьте код на первом устройстве.',
    'webdav-invalid-state': 'Файл расшифрован, но его содержимое не прошло проверку безопасности. Импорт отменён.',
    'webdav-sync-password': 'Общий пароль синхронизации должен быть не короче 10 символов.',
    'webdav-local-save': 'Серверные данные проверены, но приложение не подтвердило завершение локального сохранения. Сервер не изменён. Не очищайте данные приложения; скачайте журнал и повторите попытку.',
  } : {
    'webdav-invalid-workspace-code': 'Workspace code must be the UUID shown in WebDAV settings on an already connected device.',
    'webdav-https-required': 'Use an https:// address without embedded credentials or query parameters.',
    'webdav-invalid-folder': 'The folder path is invalid. Remove “.” or “..” path segments and check the slashes.',
    'webdav-invalid-username': 'A WebDAV username cannot contain a colon.',
    'webdav-network-or-cors': 'The server request failed: the browser could not access a response. This can be network, SSL, or CORS; browsers do not expose which one. Check the address and try opening the same URL in Safari.',
    'webdav-network': 'WebDAV network request or SSL certificate failed.',
    'webdav-timeout': 'The server did not respond in time. Check the address and try again.',
    'webdav-access-denied': 'The server rejected WebDAV access (401). Check the WebDAV username and password.',
    'webdav-forbidden': 'The server denied access (403). Credentials may be accepted, but this user lacks permission for the folder.',
    'webdav-http-404': 'The server responded, but the workspace file was not found (404). Check the full folder address and workspace code.',
    'webdav-password-or-damaged-file': 'The file was found and downloaded, but the shared sync password was wrong or the file is damaged. These cases cannot be distinguished cryptographically; local data was not replaced.',
    'webdav-protocol-version': 'This file uses an unsupported protocol version. Update the app; nothing was imported.',
    'webdav-schema-version': 'The workspace format versions do not match. Update both devices; nothing was imported.',
    'webdav-wrong-workspace': 'The code points to a different workspace. Check the code on the first device.',
    'webdav-invalid-state': 'The file decrypted, but its contents failed security validation. Import was cancelled.',
    'webdav-sync-password': 'The shared sync password must be at least 10 characters.',
    'webdav-local-save': 'The server data was verified, but the app could not confirm local saving. The server was not changed. Do not clear app data; download the log and retry.',
  };
  if (code.startsWith('webdav-http-')) return messages[code] ?? (ru ? `Сервер вернул HTTP ${code.slice('webdav-http-'.length)} во время запроса файла. Проверьте путь и права доступа.` : `The server returned HTTP ${code.slice('webdav-http-'.length)} while requesting the file. Check the path and permissions.`);
  return messages[code] ?? (stage === 'saving-local'
    ? (ru ? 'Ошибка при сохранении на устройстве. Серверные данные не менялись; попробуйте освободить место и повторить.' : 'Saving on this device failed. The server was not changed; free some storage and retry.')
    : stage === 'checking-sync-password'
      ? (ru ? 'Не удалось проверить файл или общий пароль синхронизации. Локальные данные не заменены.' : 'Could not verify the file or shared sync password. Local data was not replaced.')
      : (ru ? 'Не удалось получить файл рабочего пространства. Проверьте WebDAV-адрес, доступ и код.' : 'Could not retrieve the workspace file. Check the WebDAV address, access, and code.'));
};

export function WebDavEntry({ language, disabled, onOpen }: { language: string; disabled: boolean; onOpen: (settings: DavSettings, code: string, password: string, onStage: (stage: WebDavEntryStage) => void) => Promise<void> }) {
  const ru = language === 'ru';
  const [draft, setDraft] = useState<DavSettings>(() => ({ url: '', folder: '', username: '', password: '', syncPassword: '', deviceId: crypto.randomUUID(), enabled: true, logs: true }));
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [stage, setStage] = useState<WebDavEntryStage | null>(null);
  const [busy, setBusy] = useState(false);
  return <details className="webdav-entry settings-disclosure" translate="no"><summary>{ru ? 'Открыть через WebDAV' : 'Open from WebDAV'}</summary>
    <p>{ru ? 'Загрузите существующее рабочее пространство с сервера. Код скопируйте из настроек WebDAV на первом устройстве. Обычно достаточно адреса WebDAV: приложение добавит стандартную папку UniversalSync. Чтобы выбрать другую папку, допишите её в конец URL без завершающего слеша.' : 'Download an existing workspace from your server. Copy its code from WebDAV settings on the first device. Usually the WebDAV address is enough: the app adds its standard UniversalSync folder. To use another folder, append it to the URL without a trailing slash.'}</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(''); setStage(null);
      let failedStage: WebDavEntryStage | null = null;
      setDavDiagnosticsEnabled(draft.logs);
      auditDav('workspace-open-start', { transport: hasNativeWebDAV() ? 'native' : 'browser' });
      const onStage = (next: WebDavEntryStage) => { failedStage = next; setStage(next); auditDav('workspace-open-stage', { stage: next }); };
      try {
        await onOpen(connectionFromAddress(draft), code.trim(), draft.syncPassword, onStage);
        auditDav('workspace-open-succeeded', { passwordMode: 'shared-workspace-password' });
      } catch (reason) {
        const rawCode = reason instanceof Error ? reason.message : '';
        const safeCode = /^webdav-[a-z0-9-]+$/.test(rawCode) ? rawCode : failedStage === 'saving-local' ? 'webdav-local-save' : 'webdav-import-failed';
        auditDav('workspace-open-failed', { stage: failedStage ?? 'form-or-setup', code: safeCode });
        recordDiagnostic({ kind: 'error', message: 'WebDAV workspace open failed', operation: 'WebDAV connection', outcome: 'failed', details: JSON.stringify({ stage: failedStage ?? 'form-or-setup', code: safeCode, network: typeof navigator !== 'undefined' && navigator.onLine ? 'unknown' : 'none' }) });
        setError(openError(reason, failedStage, ru));
      } finally { setBusy(false); }
    }}>
      <fieldset disabled={disabled || busy}>
        {!hasNativeWebDAV() && <Field label={ru ? 'HTTPS-посредник (если сервер не поддерживает CORS)' : 'HTTPS proxy (if your server does not support CORS)'} hint={ru ? 'Посредник получает пароль WebDAV для передачи серверу. Используйте только доверенный адрес. Пароль шифрования пространства ему не передаётся.' : 'The proxy receives your WebDAV password to contact the server. Use a trusted endpoint only. Your workspace encryption password is not sent to it.'}><Input type="url" placeholder="https://your-worker.workers.dev/dav" value={draft.proxyUrl ?? defaultDavProxy(draft.url)} onChange={e => setDraft({ ...draft, proxyUrl: e.target.value })} /></Field>}
        <Field label={ru ? 'Адрес WebDAV (HTTPS)' : 'WebDAV URL (HTTPS)'}><Input type="url" required placeholder="https://server.example/webdav/" value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value, folder: '' })} /><small>{ru ? 'Для UniversalSync укажите адрес сервера, например …/webdav/. Другую папку можно дописать в URL без завершающего слеша.' : 'For UniversalSync, enter the server address, e.g. …/webdav/. Append a different folder to the URL without a trailing slash.'}</small></Field>
        <Field label={ru ? 'Логин WebDAV' : 'WebDAV username'}><Input autoComplete="username" required value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} /></Field>
        <Field label={ru ? 'Пароль WebDAV' : 'WebDAV password'}><Input type="password" autoComplete="current-password" required value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} /></Field>
        <Field label={ru ? 'Код рабочего пространства' : 'Workspace code'}><Input required autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={code} onChange={e => setCode(e.target.value)} /><small>{ru ? 'Это не пароль: код указывает, какой зашифрованный файл скачать. Без него нельзя безопасно выбрать нужное пространство среди файлов на сервере.' : 'This is not a password: the code identifies which encrypted file to download. Without it, the app cannot safely select the right workspace on the server.'}</small></Field>
        <Field label={ru ? 'Пароль рабочего пространства' : 'Workspace password'}><Input type="password" autoComplete="current-password" minLength={10} required value={draft.syncPassword} onChange={e => setDraft({ ...draft, syncPassword: e.target.value })} /><small>{ru ? 'Введите существующий общий пароль синхронизации с первого устройства. Этот же пароль будет открывать пространство на новом устройстве — придумывать новый не нужно.' : 'Enter the existing shared sync password from your first device. The same password will unlock the workspace on this device; no new password is needed.'}</small></Field>
        <p>{ru ? 'Данные WebDAV дают доступ к серверу, пароль пространства — к зашифрованным задачам. На уже подключённых устройствах прежний пароль входа сохраняется. Google подключается отдельно. В браузере сервер должен поддерживать CORS.' : 'WebDAV credentials give access to the server; the workspace password opens your encrypted tasks. Devices already connected keep their existing unlock password. Connect Google separately. Browser access requires server CORS support.'}</p>
        <Button type="submit">{busy ? (ru ? 'Открываем…' : 'Opening…') : (ru ? 'Загрузить и открыть' : 'Download and open')}</Button>
      </fieldset>
    </form>
    {busy && <><p role="status">{stageLabel(stage, ru) || (ru ? 'Подготавливаем подключение…' : 'Preparing connection…')}</p><progress aria-label={ru ? 'Открытие WebDAV' : 'Opening WebDAV'} /></>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
