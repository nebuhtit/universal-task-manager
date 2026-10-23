# Обмен через WebDAV / WebDAV sync

## Development diagnostics and recovery

The existing diagnostics checkbox (`logs`, default true) controls detailed collection
and log uploads. Encrypted pre-change recovery copies are always enabled independently
of diagnostics. An explicitly disabled diagnostics value
stays disabled after an upgrade. Saving the checkbox applies the setting.

- `logs/device-ID.json` remains the latest report; timestamped files preserve earlier reports.
- Manual diagnostic export and server reports include the same development audit journal.
- Every run/request has an ID. Evidence includes build/schema, device, lifecycle,
  request kind/status/ETag/bytes/duration, stage timing, queue/retry state, snapshot
  SHA-256/counts and item IDs/revisions/states. Task text and credentials are excluded.
- `recovery/` holds authenticated encrypted copies of shared local/remote branches,
  readable with the shared sync encryption password. They exclude device-only Google
  data just like the shared workspace. No overwrite/merge proceeds if a required
  recovery copy fails. Copies do not replace independent `.utmb` backups.
- Unchanged polls create no recovery copies. Existing conflict copies remain supported.
- Local audit retains at most 4000 entries / approximately 3 million characters;
  upload archives and recovery copies are retained remotely until manually removed.
- Different application versions may exchange the same supported protocol/schema.
  Unknown schema/protocol or unknown snapshot fields stop the exchange before data
  overwrite. There is no speculative downgrade or blanket promise of compatibility
  with future formats. A new format needs an explicit migration and compatibility tests.
- Runtime JS failures retain script line/column frames without arbitrary exception text.
  Screenshots are not captured automatically. Closed/locked iOS apps cannot guarantee
  periodic uploads. A sudden process kill can leave the latest evidence only on-device.
- A successful local flush means the save layer acknowledged persistence; it is not
  a separate disk readback. Use a rebuilt physical device's fresh log to verify behavior.

For subsequent UTM requests, inspect fresh reports and review events for recent
changes; identify stale builds explicitly. The working rule is recorded in AGENTS.md.

## Настройка

1. Сделайте обычную зашифрованную копию `.utmb`. Сохраните её отдельно: синхронизация не заменяет резервное копирование.
2. На втором устройстве импортируйте эту же копию. У устройств должен совпадать `workspaceId`, а не только название рабочего пространства.
3. В **Настройки → Синхронизация WebDAV** на каждом устройстве укажите собственный HTTPS-адрес WebDAV, папку, логин и пароль. Приложение не содержит общего сервера или встроенной учётной записи.
4. Придумайте отдельный общий пароль шифрования синхронизации (минимум 10 символов), одинаковый на обоих устройствах. Он не передаётся серверу. Потеря этого пароля делает серверную копию нечитаемой.
5. Включите автоматический обмен, затем нажмите **Проверить и сохранить**. Настройки подключения и контрольная копия предыдущего обмена зашифрованы ключом рабочего пространства только на этом устройстве, не включены в `.utmb` и не передаются другим устройствам.
6. Сначала завершите успешный обмен на первом устройстве, затем подключайте второе. При первоначальном подключении отличающихся копий возможен запрос разрешения конфликтов.

Обмен выполняется раз в минуту, через 5 секунд после изменения и при возврате в приложение, если оно открыто, разблокировано, имеет сеть и находится на экране. Постоянная работа в фоне и после закрытия **не гарантируется** ни в iOS, ни в PWA. FTPS в этой реализации отсутствует: для браузера ему нужен отдельный HTTPS-посредник.

Переносятся пользовательские задачи, связи, сохранённые views и их порядок, PARA, определения полей, dashboards и automations. Язык, оформление, календарные настройки, Google OAuth/зеркало календаря/очередь исходящей синхронизации и настройки Web Push остаются локальными. Google-синхронизация этим механизмом не вызывается и не изменяется.

## Требования сервера

- HTTPS с действительным сертификатом; без перенаправлений на другой адрес. Логин и пароль задаются отдельными полями, не внутри URL.
- Чтение/запись и создание папок: `GET`, `PUT`, `MKCOL`. Для удаления собственных тестовых файлов желательно разрешить `DELETE`.
- Ответ `GET` должен содержать **сильный ETag** (не `W/…`).
- `PUT` с устаревшим `If-Match` обязан отвечать `412` без изменения содержимого. Для создания нового файла поддерживается `PUT` с `If-None-Match: *`. Если встроенный сервер отвергает этот заголовок даже для отсутствующих файлов, используется стандартная альтернатива: запись случайного временного файла и `MOVE` с `Overwrite: F`. Перенос обязан отвечать `412`, если целевой файл уже существует. Этот вариант тоже проверяется до обмена данными.
- При первом соединении в каждом сеансе приложение проверяет это на отдельном случайном `probe-….json`. Проверка не затрагивает существующие пользовательские файлы. Если условная запись не работает, обмен блокируется, а не переходит на опасную безусловную перезапись. Если сервер запрещает DELETE, маленький тестовый файл может остаться.
- **Только для браузера/PWA:** разрешите CORS для origin вашего приложения (например, `https://nebuhtit.github.io` — без пути репозитория), OPTIONS без Basic-авторизации, методы `GET, PUT, MKCOL, MOVE, DELETE, OPTIONS, LOCK, UNLOCK`, заголовки `Authorization, Content-Type, If-Match, If-None-Match, Destination, Overwrite, If, Lock-Token, Timeout, Depth` и `Access-Control-Expose-Headers: ETag, Lock-Token, Timeout`. Эти заголовки нужны и на ошибках, в частности `404`/`412`/`423`. Наличие пароля не отменяет CORS.
- **iPhone/Xcode:** встроенный HTTPS-модуль не ограничен браузерным CORS, но сохраняет проверку сертификатов, таймауты и запрет редиректов. Нужна пересборка iOS-приложения, не только обновление сайта.

## Конфликты и восстановление

Объединяются изменения разных полей относительно предыдущего успешного обмена. Одновременное изменение одного поля, удаление против изменения и разные перестановки списка не разрешаются произвольно по часам устройства. Приложение приостанавливает автоматический обмен и предлагает выбрать локальные или серверные значения только для конфликтующих полей.

Перед выбором обе ветки сохраняются в отдельные зашифрованные `conflict-….json`. Эти файлы намеренно не удаляются автоматически. Они используют тот же пароль синхронизации и формат `UTM-WEBDAV`, **это не обычные `.utmb`**; для восстановления отдельных значений нужен инструмент чтения этого формата или помощь разработчика. Не удаляйте их до проверки результата.

Запись основной серверной копии выполняется под эксклюзивной серверной блокировкой LOCK с ограниченным сроком и дополнительно условно по ETag. Перед записью блокировка продлевается, после обмена освобождается; после аварии она истекает на сервере (Keenetic подтверждает 300 секунд). Приложение читает записанный файл обратно и проверяет расшифрованные данные перед обновлением контрольной точки. Занятость сервера вызывает повтор с паузой; гонки повторяются с небольшим случайным интервалом. Изменения, введённые во время отправки, остаются локально и уходят при следующем обмене. Сервер без проверяемой блокировки не допускается к обмену.

### Проверка Keenetic 23 октября 2026

Проверка на случайном файле показала гонку If-Match: два параллельных PUT получили 204 с одним исходным ETag. Поэтому одной условной записи недостаточно. LOCK прошёл три раунда: ровно один владелец, отказ второму (423 или серверный 500), отказ PUT без токена (423), успешная запись с токеном, продление, освобождение и отказ устаревшему токену. Полный тест двух синтетических устройств на реальном сервере также прошёл; изолированная папка удалена. Это не проверка устойчивости носителя к отключению питания.

Повторяемый инструмент: `scripts/check-webdav-concurrency.mjs`. Настройки только через `UTM_WEBDAV_TEST_URL`, `UTM_WEBDAV_TEST_USER`, `UTM_WEBDAV_TEST_PASSWORD`; `UTM_WEBDAV_TEST_LOCK=1` проверяет LOCK, без него — гонку ETag. Опционально `UTM_WEBDAV_TEST_IP` и `UTM_WEBDAV_INTERFACE` обходят проблемный сетевой маршрут при сохранении проверки HTTPS. Инструмент использует только случайный probe-файл и удаляет его после проверки. Интеграционный тест `webdavLive.test.ts` работает в отдельной созданной им папке и очищает её.

## Логи

Опция логов создаёт `logs/device-<случайный-id>.json`; каждое устройство перезаписывает только свой файл. В файле результат последнего обмена, версия приложения, время, категория платформы/типа устройства/браузера и до 200 последних локальных диагностических событий в виде категорий, статусов и числовой длительности. Точную модель браузер может сообщить не всегда; если сообщает, она включается отдельно. Полный User-Agent не сохраняется. Если локальная диагностика выключена, подробных событий может не быть. Нет текста задач, имён, адреса сервера, паролей, токенов или необработанных сообщений ошибок. Логи **не зашифрованы**, но доступ к папке защищён сервером. Отключение записи не удаляет ранее созданные файлы.

Разработчик/ассистент не получает постоянный доступ автоматически. Для разбора нужно предоставить доступ к папке, смонтировать WebDAV на Mac или передать файл лога. Ошибка загрузки лога показывается отдельно и не отменяет успешный обмен данными.

## English quick start

Import the same encrypted `.utmb` on both devices first. In Settings → WebDAV synchronization, enter your own HTTPS server, folder and credentials, and the same separate sync encryption password (at least 10 characters). Enable automatic sync and check/save the settings. A server must support strong ETags, conditional PUT and finite exclusive LOCK/UNLOCK; browsers additionally require CORS, unauthenticated preflight, and exposed ETag, Lock-Token and Timeout headers. Native iOS uses a dedicated HTTPS bridge and requires rebuilding the Xcode app.

Synchronization runs only while open and unlocked, after edits, on return and every minute. It shares user tasks, relationships, views/order and PARA, not Google credentials/cache/outbox or device preferences. Same-field conflicts stop automatic sync and retain encrypted copies of both branches. Safe optional logs overwrite one readable, redacted file per device. Keep independent `.utmb` backups; syncing also propagates deletions.

## Автономная проверка для разработчика

`pnpm exec vitest run apps/web/src/services/webdavSync.test.ts apps/web/src/features/settings/WebDavSettings.test.tsx` проверяет объединение, удаления, шифрование, гонки, сбои сохранения и безопасную альтернативу MOVE без подключения к серверу. Интерфейс: `pnpm exec playwright test tests/e2e/webdav-settings.spec.ts` (отдельные браузеры, EN/RU, desktop/mobile, светлая/тёмная темы). Мобильная эмуляция не заменяет проверку настоящего iPhone.

`apps/web/src/services/webdavLive.test.ts` по умолчанию пропускается. Для явного живого теста передайте в окружении `UTM_WEBDAV_TEST_URL`, `UTM_WEBDAV_TEST_USER`, `UTM_WEBDAV_TEST_PASSWORD`, затем запустите `pnpm exec vitest run apps/web/src/services/webdavLive.test.ts`. Не записывайте реальные значения в исходники или команды общего CI. Тест создаёт отдельную папку `utm-fixture-<UUID>`, использует только вымышленные задачи и удаляет свои известные файлы и папку после проверки. Пользовательские файлы не перечисляются и не читаются. При аварийном обрыве процесса тестовая папка может остаться.
# Opening on a second device

After the first device successfully synchronizes, copy its workspace code from
WebDAV settings. On a fresh installation choose **Open from WebDAV** and enter
the WebDAV endpoint, credentials, workspace code and shared sync password. The
app uses its standard `UniversalSync` folder automatically. To choose a custom
folder, append that path to the URL without a trailing slash. Choose a new local
password for this device. This downloads and validates the encrypted snapshot
without writing to the server, persists it locally, and stores its baseline and
device connection settings before entering the workspace.
An existing local workspace is never replaced by this entry flow: unlock it and
use its synchronization settings, or use the existing explicit backup workflow.
Google credentials and device preferences are not transferred.

**Test connection** rechecks read/write protection without saving edited settings;
**Check and save** verifies and persists them. Operations show an indeterminate
progress indicator and named stages, not an invented percentage. Safe diagnostics
include the stages and network type when exposed by the browser; iOS WKWebView
may report `unknown` for Wi-Fi versus cellular.

For a two-device Xcode smoke test, run the iOS target on a physical iPhone and an
iOS Simulator on the Mac. Open the same workspace using the procedure above,
edit different tasks on each device, sync both, and reopen to verify persistence.
The current project targets iOS only; a native macOS/Catalyst target is not part
of this change. Browser testing on Mac additionally requires server CORS support.
