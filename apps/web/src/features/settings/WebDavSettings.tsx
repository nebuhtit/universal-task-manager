import { useEffect, useState } from 'react';
import { Button, Checkbox, Field, Input } from '../../components/ui/primitives';
import { hasNativeWebDAV } from '../../services/webdavTransport';
import type { DavSettings } from '../../services/webdavSync';
import type { WebDavController } from '../../hooks/useWebDavSync';

export function WebDavSettings({ controller, language }: { controller: WebDavController; language: string }) {
  const ru = language === 'ru';
  const empty = (): DavSettings => ({ url: '', folder: 'UniversalSync', username: '', password: '', syncPassword: '', deviceId: crypto.randomUUID(), enabled: false, logs: true });
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState('');
  // Do not reset the typed connection/password fields after a background sync.
  useEffect(() => { if (controller.settings) setDraft(controller.settings); }, [controller.settings?.url, controller.settings?.username, controller.settings?.password, controller.settings?.syncPassword, controller.settings?.enabled, controller.settings?.logs, controller.settings?.folder]);
  const labels: Record<string, string> = {
    'webdav-not-configured': ru ? 'Не настроено' : 'Not configured',
    'webdav-ready': ru ? 'Готово к обмену' : 'Ready',
    'webdav-paused': ru ? 'Автоматический обмен выключен' : 'Automatic sync is off',
    'webdav-syncing': ru ? 'Синхронизация…' : 'Synchronizing…',
    'webdav-checking': ru ? 'Проверка сервера…' : 'Checking server…',
    'webdav-downloading': ru ? 'Загрузка данных…' : 'Downloading data…',
    'webdav-merging': ru ? 'Сравнение изменений…' : 'Comparing changes…',
    'webdav-uploading': ru ? 'Отправка изменений…' : 'Uploading changes…',
    'webdav-saving': ru ? 'Сохранение результата…' : 'Saving result…',
    'webdav-testing': ru ? 'Проверка подключения и защиты от перезаписи…' : 'Checking connection and conditional writes…',
    'webdav-succeeded': ru ? 'Синхронизировано' : 'Synchronized',
    'webdav-access-denied': ru ? 'Сервер отклонил доступ. Проверьте логин, пароль и разрешение записи.' : 'Access denied. Check credentials and write permissions.',
    'webdav-network-or-cors': ru ? 'Нет подключения или сервер блокирует CORS. Проверьте HTTPS, доступность, OPTIONS и разрешённый Origin.' : 'Network or CORS failure. Check HTTPS, availability, OPTIONS and allowed Origin.',
    'webdav-network': ru ? 'Ошибка сети или сертификата HTTPS.' : 'Network or HTTPS certificate error.',
    'webdav-timeout': ru ? 'Сервер не ответил вовремя.' : 'Server timed out.',
    'webdav-etag-required': ru ? 'Сервер должен выдавать сильный ETag; в браузере разрешите чтение заголовка ETag через CORS.' : 'A strong ETag is required; browsers also need Access-Control-Expose-Headers: ETag.',
    'webdav-conditional-writes-required': ru ? 'Сервер не обеспечивает безопасное создание и условную запись (If-Match, If-None-Match или MOVE без перезаписи). Обмен заблокирован.' : 'Server does not provide safe creation and conditional writes (If-Match, If-None-Match or MOVE without overwrite). Sync is blocked.',
    'webdav-password-or-damaged-file': ru ? 'Пароль синхронизации не подходит или файл повреждён. Перезаписи не было.' : 'Wrong sync password or damaged file. Nothing was overwritten.',
    'webdav-sync-password': ru ? 'Задайте общий пароль синхронизации не короче 10 символов.' : 'Use a shared sync password of at least 10 characters.',
    'webdav-conflict': ru ? 'Есть одновременные несовместимые изменения. Обе ветки сохранены; выберите, какой вариант использовать в конфликтах.' : 'Concurrent conflicting edits. Both branches are retained; choose which values to use for conflicts.',
    'webdav-schema-version': ru ? 'Версии формата отличаются. Обновите приложения на обоих устройствах.' : 'Schema versions differ. Update both devices.',
    'webdav-wrong-workspace': ru ? 'Это другое рабочее пространство. Импортируйте один и тот же .utmb на обоих устройствах.' : 'Different workspace. Import the same .utmb on both devices.',
    'webdav-config-unreadable': ru ? 'Не удалось прочитать настройки этого устройства. Введите их заново.' : 'Cannot read this device’s settings. Enter them again.',
    'webdav-https-required': ru ? 'Нужен HTTPS-адрес без логина, пароля и параметров в URL.' : 'Use an HTTPS URL without embedded credentials or query parameters.',
  };
  const message = labels[controller.status] ?? (ru ? `Обмен не завершён (${controller.status}). Проверьте локальное сохранение перед закрытием приложения.` : `Sync did not finish (${controller.status}). Check local persistence before closing the app.`);
  return <details className="settings-disclosure" translate="no"><summary>{ru ? 'Синхронизация WebDAV' : 'WebDAV synchronization'}</summary><section className="settings-card" aria-label="WebDAV settings">
    {controller.workspaceId && <Field label={ru ? 'Код для входа на другом устройстве' : 'Code for opening on another device'}><Input readOnly value={controller.workspaceId} onFocus={event => event.target.select()} /></Field>}
    <p>{ru ? 'Ваш сервер, сквозное шифрование. Настройки подключения сохраняются только на этом устройстве, зашифрованными ключом рабочего пространства.' : 'Your server, end-to-end encryption. Connection settings stay on this device, encrypted with the workspace key.'}</p>
    <p>{ru ? 'На новом устройстве выберите «Открыть через WebDAV» на стартовом экране и введите код выше, сервер, папку и общий пароль синхронизации. Также можно импортировать тот же .utmb. Пароль синхронизации может отличаться от пароля WebDAV и локального пароля приложения.' : 'On a new device, choose “Open from WebDAV” on the start screen and enter the code above, server, folder and shared sync password. Importing the same .utmb is also supported. The sync password can differ from the WebDAV and local app passwords.'}</p>
    <Field label={ru ? 'Адрес WebDAV (HTTPS)' : 'WebDAV URL (HTTPS)'}><Input type="url" autoComplete="off" placeholder="https://example.com/webdav/" value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} /></Field>
    <Field label={ru ? 'Папка внутри WebDAV' : 'Folder inside WebDAV'}><Input value={draft.folder} onChange={e => setDraft({ ...draft, folder: e.target.value })} /></Field>
    <Field label={ru ? 'Логин WebDAV' : 'WebDAV username'}><Input autoComplete="username" value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} /></Field>
    <Field label={ru ? 'Пароль WebDAV' : 'WebDAV password'}><Input type="password" autoComplete="current-password" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} /></Field>
    <Field label={ru ? 'Общий пароль шифрования синхронизации' : 'Shared sync encryption password'}><Input type="password" minLength={10} autoComplete="new-password" value={draft.syncPassword} onChange={e => setDraft({ ...draft, syncPassword: e.target.value })} /></Field>
    <Checkbox checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} label={ru ? 'Автоматический обмен, пока приложение открыто и разблокировано' : 'Automatic sync while the app is open and unlocked'} />
    <Checkbox checked={draft.logs} onChange={e => setDraft({ ...draft, logs: e.target.checked })} label={ru ? 'Автоматически сохранять безопасные логи в папку logs' : 'Automatically save safe diagnostics to the logs folder'} />
    <p>{ru ? 'Обмен — раз в минуту, после изменений и при возврате в приложение. В закрытом приложении iOS и браузер не гарантируют фоновую работу. Google-авторизация, кэш календаря и настройки уведомлений устройства не переносятся; задачи, views и PARA — переносятся.' : 'Sync runs every minute, after changes and on return. iOS and browsers do not guarantee execution while closed. Google sign-in, calendar cache and device notification settings stay local; tasks, views and PARA are shared.'}</p>
    <p>{hasNativeWebDAV() ? (ru ? 'Прямое подключение iOS; браузерный CORS не требуется.' : 'Direct native iOS connection; browser CORS is not required.') : (ru ? 'Для веб-версии сервер должен разрешить CORS: ваш Origin, OPTIONS без авторизации, методы GET/PUT/MKCOL/MOVE/DELETE и заголовки Authorization, Content-Type, If-Match, If-None-Match, Destination, Overwrite; открыть ETag для чтения. Без этого пароль не поможет.' : 'Browser access requires CORS: your Origin, unauthenticated OPTIONS, GET/PUT/MKCOL/MOVE/DELETE, Authorization, Content-Type, If-Match, If-None-Match, Destination, Overwrite and exposed ETag. Credentials cannot bypass CORS.')}</p>
    <p>{ru ? 'Логи открытые, но без текста задач, адресов сервера и паролей. Каждый аппарат перезаписывает свой файл с тем же журналом, что и при ручном экспорте. Платформа и тип устройства записываются без полного User-Agent.' : 'Logs are readable but omit task text, server addresses and passwords. Each device replaces its own file with the same journal as the manual export. Platform and device type are recorded without the full User-Agent.'}</p>
    <div className="settings-actions"><Button disabled={controller.running || !draft.url} onClick={async () => { setError(''); try { await controller.save(draft); } catch { setError(ru ? 'Не удалось проверить или сохранить настройки. См. статус ниже.' : 'Could not verify or save settings. See the status below.'); } }}>{ru ? 'Проверить и сохранить' : 'Check and save'}</Button><Button disabled={controller.running || !controller.settings} onClick={() => void controller.synchronize()}>{ru ? 'Синхронизировать сейчас' : 'Sync now'}</Button></div>
    <Button disabled={controller.running || !draft.url} onClick={() => void controller.check(draft)}>{ru ? 'Проверить подключение' : 'Test connection'}</Button>
    {controller.running && <progress aria-label={ru ? 'Обмен WebDAV' : 'WebDAV operation'} />}
    <p role="status">{message}</p>{error && <p role="alert">{error}</p>}
    {controller.lastSuccess && <p>{ru ? 'Последний успешный обмен: ' : 'Last successful sync: '}{new Date(controller.lastSuccess).toLocaleString(ru ? 'ru' : 'en')}</p>}
    {controller.logError && <p role="alert">{ru ? 'Отправить лог не удалось. Это не отменяет результат обмена данными.' : 'Log upload failed. This does not undo the data synchronization result.'}</p>}
    {controller.conflict && <><p>{ru ? 'Конфликтующих полей: ' : 'Conflicting fields: '}{controller.conflict.conflicts.length}</p><div className="settings-actions">{(['local', 'remote'] as const).map(resolution => <Button key={resolution} disabled={controller.running} onClick={() => { if (window.confirm(ru ? 'Применить этот выбор только к конфликтующим полям? Остальные изменения будут объединены. Зашифрованная копия локальной ветки оставлена на сервере.' : 'Apply this choice only to conflicting fields? Other edits will be merged. An encrypted copy of the local branch is retained on the server.')) void controller.synchronize(resolution); }}>{resolution === 'local' ? (ru ? 'В конфликтах — это устройство' : 'Use this device for conflicts') : (ru ? 'В конфликтах — сервер' : 'Use server for conflicts')}</Button>)}</div></>}
  </section></details>;
}
