import type { WorkspaceLanguage } from '@utm/core';

export const interfaceLanguages: Array<{ value: WorkspaceLanguage; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'ko', label: '한국어' },
];

type Dictionary = Record<string, string>;
type TranslationTable = Record<Exclude<WorkspaceLanguage, 'en'>, Dictionary>;

const en = {
  Home: 'Главная', 'All items': 'Все элементы', Settings: 'Настройки', Lock: 'Заблокировать', Transfer: 'Передача',
  Notifications: 'Уведомления', 'No notifications': 'Нет уведомлений', 'Encrypted locally': 'Зашифровано локально',
  'Add new task': 'Добавить новую задачу', 'Add new item': 'Добавить новый элемент', 'Add task': 'Добавить задачу', 'New item': 'Новый элемент', 'New view': 'Новый вид',
  'Edit view': 'Редактировать вид', 'Save view': 'Сохранить вид', Cancel: 'Отмена', Delete: 'Удалить', 'Delete view': 'Удалить вид',
  Active: 'Активные', Completed: 'Завершённые', 'Auto closed': 'Закрыты автоматически',
  Cancelled: 'Отменённые', Archived: 'В архиве', 'Recurring items': 'Повторяющиеся элементы',
  'No recurring items yet.': 'Повторяющихся элементов пока нет.', 'No items match this view.': 'Нет элементов, соответствующих этому виду.',
  'Everything is clear': 'Всё выполнено', 'active item': 'активный элемент', 'active items': 'активных элементов',
  'View details': 'Параметры вида', 'Move your data': 'Перенести данные', 'Encrypted Transfer': 'Зашифрованная передача',
  'Export all…': 'Экспортировать всё…', 'Import data…': 'Импортировать данные…', 'Request permission': 'Запросить разрешение',
  'Custom fields': 'Пользовательские поля', '+ Add': '+ Добавить', 'No custom fields yet.': 'Пользовательских полей пока нет.',
  APPLICATION: 'ПРИЛОЖЕНИЕ', WORKSPACE: 'ПРОСТРАНСТВО', PORTABILITY: 'ПЕРЕНОС ДАННЫХ', DEVICE: 'УСТРОЙСТВО', 'DATA MODEL': 'МОДЕЛЬ ДАННЫХ',
  Version: 'Версия', Released: 'Выпущено', Schema: 'Схема', Items: 'Элементы', 'Workspace ID': 'ID пространства',
  'Interface language': 'Язык интерфейса', 'Choose the language used by the app on this device. Item titles and your data are never translated.': 'Выберите язык интерфейса на этом устройстве. Названия элементов и ваши данные не переводятся.',
  Language: 'Язык', 'Build your own system': 'Создайте свою систему', 'Unlock your workspace': 'Разблокируйте пространство',
  'Workspace name': 'Название пространства', Password: 'Пароль', 'Confirm password': 'Подтвердите пароль', Unlock: 'Разблокировать',
  'Create encrypted workspace': 'Создать зашифрованное пространство', 'Working…': 'Выполняется…',
  'Already have an encrypted workspace?': 'Уже есть зашифрованное пространство?', 'Import .utm': 'Импорт .utmb',
  'Cannot unlock or need to clear this site\'s data?': 'Не получается войти или нужно очистить данные сайта?',
  'Save encrypted recovery copy + log': 'Сохранить зашифрованную копию и лог',
  'No password is required to save it. Workspace data remains encrypted; safe troubleshooting entries are included in the same file.': 'Для сохранения пароль не нужен. Данные пространства остаются зашифрованными, а безопасная диагностика входа включается в тот же файл.',
  'Save old version and update': 'Сохранить старую версию и обновить', 'Download old encrypted copy': 'Скачать старую зашифрованную копию', 'Open recovery mode': 'Открыть режим восстановления',
  'Workspace versions': 'Версии пространства', 'Items needing repair': 'Элементы, требующие ремонта', 'Choose start': 'Выбрать начало', 'Remove recurrence': 'Удалить повторение',
  'Appearance and sounds': 'Оформление и звуки', 'Custom fields and testing': 'Пользовательские поля и тестирование', 'Data, notifications and application': 'Данные, уведомления и приложение', 'Compatibility repairs': 'Исправление совместимости', 'Backup and recovery': 'Резервные копии и восстановление', Diagnostics: 'Диагностика', 'Device unlock': 'Разблокировка устройства',
  'Download encrypted workspace + log': 'Скачать зашифрованное пространство и лог', 'Retry normal startup': 'Повторить обычный запуск',
  Help: 'Помощь', 'Recovery before unlocking': 'Восстановление до входа',
  'Decrypt any UTM backup': 'Расшифровать любую резервную копию UTM',
  'Choose encrypted file': 'Выбрать зашифрованный файл', 'Choose another encrypted file': 'Выбрать другой зашифрованный файл',
  'File password': 'Пароль файла', 'Decrypt and download readable JSON': 'Расшифровать и скачать читаемый JSON', 'Decrypting…': 'Расшифровка…',
  'Install on your phone': 'Установка на телефон', 'Troubleshooting log': 'Технический журнал', 'Download log': 'Скачать лог', 'Clear log': 'Очистить лог',
  'Opening encrypted workspace…': 'Открытие зашифрованного пространства…', 'System metadata': 'Системные метаданные',
  'Item JSON': 'JSON элемента', 'View JSON': 'JSON вида', 'DSL expression': 'DSL-выражение', 'Sort DSL': 'DSL-сортировка',
  'Displayed fields': 'Отображаемые поля', Renderer: 'Отображение', Sorting: 'Сортировка', 'Visual condition': 'Визуальное условие',
  Field: 'Поле', Operator: 'Оператор', Value: 'Значение', 'Apply condition': 'Применить условие', 'Add AND condition': 'Добавить И', 'Add OR condition': 'Добавить ИЛИ',
  Title: 'Название', Description: 'Описание', Status: 'Статус', Priority: 'Приоритет', Tags: 'Теги', Contexts: 'Контексты',
  'Dates & time': 'Дата и время', Reminders: 'Напоминания', 'Available to work from': 'Доступно с', 'Scheduled start': 'Начало', 'Scheduled end': 'Окончание', Deadline: 'Срок', 'Event opens': 'Событие начинается', 'Event ends': 'Событие заканчивается', 'Due / Active range ends': 'Срок / конец активного диапазона', 'Active range': 'Активный диапазон', 'Only show during the active range': 'Показывать только в активном диапазоне', Timezone: 'Часовой пояс',
  'Estimated duration': 'Оценка длительности', 'Actual duration': 'Фактическая длительность', 'All day': 'Весь день',
  None: 'Нет', Low: 'Низкий', Medium: 'Средний', High: 'Высокий', Urgent: 'Срочный',
  Task: 'Задача', Event: 'Событие', Habit: 'Привычка', Blank: 'Пустой', 'Save item': 'Сохранить элемент',
  'Close notification': 'Закрыть уведомление', 'Delete notification': 'Удалить уведомление', 'Notification center': 'Центр уведомлений',
  Calendar: 'Календарь', Today: 'Сегодня', 'Calendar settings': 'Настройки календаря', 'Show weekends': 'Показывать выходные',
  'Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.': 'Зашифрованная передача безопасна для полного объединения пространства. Для читаемых экспортов действуют те же правила предварительного просмотра, добавления и копирования.',
  'Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.': 'Локальные напоминания появляются, пока приложение открыто. Фоновая доставка использует дополнительный Web Push, а бесплатный план Cloudflare проверяет наступившие напоминания каждые 15 минут.',
  'Background notifications': 'Фоновые уведомления', 'Off — reminders stay only on this device while the app is open.': 'Выключено — напоминания остаются только на этом устройстве, пока приложение открыто.', 'Enable background delivery': 'Включить фоновые уведомления', 'Backups are manual in this web app': 'Резервные копии в этом веб-приложении создаются вручную', 'Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.': 'Браузеры и iOS не позволяют PWA незаметно записывать зашифрованные копии в выбранную папку. При экспорте выберите папку в Files, затем замените там предыдущую копию.', 'Planning & attention': 'Планирование и внимание', Trash: 'Корзина',
  'No automations yet': 'Автоматизаций пока нет', 'Execution log': 'Журнал выполнения', Enable: 'Включить', Disable: 'Выключить', Edit: 'Редактировать',
} satisfies Dictionary;

const common: Record<Exclude<WorkspaceLanguage, 'en'>, Record<string, string>> = {
  ru: en,
  es: {
    Home: 'Inicio', 'All items': 'Todos los elementos', Settings: 'Ajustes', Lock: 'Bloquear', Transfer: 'Transferir', Notifications: 'Notificaciones', 'No notifications': 'No hay notificaciones', 'Encrypted locally': 'Cifrado localmente', 'Add new task': 'Añadir nueva tarea', 'Add task': 'Añadir tarea', 'New item': 'Nuevo elemento', 'New view': 'Nueva vista', 'Edit view': 'Editar vista', 'Save view': 'Guardar vista', Cancel: 'Cancelar', Delete: 'Eliminar', 'Delete view': 'Eliminar vista', Active: 'Activos', Completed: 'Completados', 'Auto closed': 'Cerrados automáticamente', Cancelled: 'Cancelados', Archived: 'Archivados', 'Recurring items': 'Elementos recurrentes', 'No recurring items yet.': 'Aún no hay elementos recurrentes.', 'No items match this view.': 'Ningún elemento coincide con esta vista.', 'Everything is clear': 'Todo está al día', 'View details': 'Detalles de la vista', 'Move your data': 'Mover tus datos', 'Encrypted Transfer': 'Transferencia cifrada', 'Export all…': 'Exportar todo…', 'Import data…': 'Importar datos…', 'Request permission': 'Solicitar permiso', 'Custom fields': 'Campos personalizados', '+ Add': '+ Añadir', 'No custom fields yet.': 'Aún no hay campos personalizados.', Version: 'Versión', Released: 'Publicado', Schema: 'Esquema', Items: 'Elementos', 'Workspace ID': 'ID del espacio', 'Interface language': 'Idioma de la interfaz', 'Choose the language used by the app on this device. Item titles and your data are never translated.': 'Elige el idioma de la aplicación en este dispositivo. Los títulos y tus datos nunca se traducen.', Language: 'Idioma', 'Build your own system': 'Crea tu propio sistema', 'Unlock your workspace': 'Desbloquea tu espacio', 'Workspace name': 'Nombre del espacio', Password: 'Contraseña', 'Confirm password': 'Confirmar contraseña', Unlock: 'Desbloquear', 'Create encrypted workspace': 'Crear espacio cifrado', 'Working…': 'Trabajando…', 'Already have an encrypted workspace?': '¿Ya tienes un espacio cifrado?', 'Import .utm': 'Importar .utm', 'Opening encrypted workspace…': 'Abriendo espacio cifrado…', 'System metadata': 'Metadatos del sistema', 'Item JSON': 'JSON del elemento', 'View JSON': 'JSON de la vista', 'DSL expression': 'Expresión DSL', 'Sort DSL': 'Ordenación DSL', 'Displayed fields': 'Campos mostrados', Renderer: 'Vista', Sorting: 'Ordenación', 'Visual condition': 'Condición visual', Field: 'Campo', Operator: 'Operador', Value: 'Valor', Title: 'Título', Description: 'Descripción', Status: 'Estado', Priority: 'Prioridad', Tags: 'Etiquetas', Contexts: 'Contextos', 'Dates & time': 'Fecha y hora', Reminders: 'Recordatorios', 'Scheduled start': 'Inicio programado', 'Scheduled end': 'Fin programado', Deadline: 'Fecha límite', Timezone: 'Zona horaria', 'Estimated duration': 'Duración estimada', 'Actual duration': 'Duración real', 'All day': 'Todo el día', None: 'Ninguna', Low: 'Baja', Medium: 'Media', High: 'Alta', Urgent: 'Urgente', Task: 'Tarea', Event: 'Evento', Habit: 'Hábito', Blank: 'Vacío', 'Save item': 'Guardar elemento', Calendar: 'Calendario', Today: 'Hoy', 'Calendar settings': 'Ajustes del calendario', 'Show weekends': 'Mostrar fines de semana', 'No automations yet': 'Aún no hay automatizaciones', 'Execution log': 'Registro de ejecución', Enable: 'Activar', Disable: 'Desactivar', Edit: 'Editar',
  },
  de: {
    Home: 'Startseite', 'All items': 'Alle Elemente', Settings: 'Einstellungen', Lock: 'Sperren', Transfer: 'Übertragen', Notifications: 'Benachrichtigungen', 'No notifications': 'Keine Benachrichtigungen', 'Encrypted locally': 'Lokal verschlüsselt', 'Add new task': 'Neue Aufgabe hinzufügen', 'Add task': 'Aufgabe hinzufügen', 'New item': 'Neues Element', 'New view': 'Neue Ansicht', 'Edit view': 'Ansicht bearbeiten', 'Save view': 'Ansicht speichern', Cancel: 'Abbrechen', Delete: 'Löschen', 'Delete view': 'Ansicht löschen', Active: 'Aktiv', Completed: 'Erledigt', 'Auto closed': 'Automatisch geschlossen', Cancelled: 'Abgebrochen', Archived: 'Archiviert', 'Recurring items': 'Wiederkehrende Elemente', 'No recurring items yet.': 'Noch keine wiederkehrenden Elemente.', 'No items match this view.': 'Keine Elemente passen zu dieser Ansicht.', 'Everything is clear': 'Alles erledigt', 'View details': 'Ansichtsdetails', 'Move your data': 'Daten übertragen', 'Encrypted Transfer': 'Verschlüsselte Übertragung', 'Export all…': 'Alles exportieren…', 'Import data…': 'Daten importieren…', 'Request permission': 'Berechtigung anfordern', 'Custom fields': 'Benutzerdefinierte Felder', '+ Add': '+ Hinzufügen', 'No custom fields yet.': 'Noch keine benutzerdefinierten Felder.', Version: 'Version', Released: 'Veröffentlicht', Schema: 'Schema', Items: 'Elemente', 'Workspace ID': 'Arbeitsbereich-ID', 'Interface language': 'Sprache der Oberfläche', 'Choose the language used by the app on this device. Item titles and your data are never translated.': 'Wähle die Sprache der App auf diesem Gerät. Elementtitel und deine Daten werden nie übersetzt.', Language: 'Sprache', 'Build your own system': 'Baue dein eigenes System', 'Unlock your workspace': 'Arbeitsbereich entsperren', 'Workspace name': 'Name des Arbeitsbereichs', Password: 'Passwort', 'Confirm password': 'Passwort bestätigen', Unlock: 'Entsperren', 'Create encrypted workspace': 'Verschlüsselten Arbeitsbereich erstellen', 'Working…': 'Wird verarbeitet…', 'Already have an encrypted workspace?': 'Schon einen verschlüsselten Arbeitsbereich?', 'Import .utm': '.utm importieren', 'Opening encrypted workspace…': 'Verschlüsselter Arbeitsbereich wird geöffnet…', 'System metadata': 'Systemmetadaten', 'Item JSON': 'Element-JSON', 'View JSON': 'Ansichts-JSON', 'DSL expression': 'DSL-Ausdruck', 'Sort DSL': 'DSL-Sortierung', 'Displayed fields': 'Angezeigte Felder', Renderer: 'Darstellung', Sorting: 'Sortierung', 'Visual condition': 'Visuelle Bedingung', Field: 'Feld', Operator: 'Operator', Value: 'Wert', Title: 'Titel', Description: 'Beschreibung', Status: 'Status', Priority: 'Priorität', Tags: 'Tags', Contexts: 'Kontexte', 'Dates & time': 'Datum und Uhrzeit', Reminders: 'Erinnerungen', 'Scheduled start': 'Geplanter Beginn', 'Scheduled end': 'Geplantes Ende', Deadline: 'Frist', Timezone: 'Zeitzone', 'Estimated duration': 'Geschätzte Dauer', 'Actual duration': 'Tatsächliche Dauer', 'All day': 'Ganztägig', None: 'Keine', Low: 'Niedrig', Medium: 'Mittel', High: 'Hoch', Urgent: 'Dringend', Task: 'Aufgabe', Event: 'Ereignis', Habit: 'Gewohnheit', Blank: 'Leer', 'Save item': 'Element speichern', Calendar: 'Kalender', Today: 'Heute', 'Calendar settings': 'Kalendereinstellungen', 'Show weekends': 'Wochenenden anzeigen', 'No automations yet': 'Noch keine Automatisierungen', 'Execution log': 'Ausführungsprotokoll', Enable: 'Aktivieren', Disable: 'Deaktivieren', Edit: 'Bearbeiten',
  },
  fr: {
    Home: 'Accueil', 'All items': 'Tous les éléments', Settings: 'Réglages', Lock: 'Verrouiller', Transfer: 'Transférer', Notifications: 'Notifications', 'No notifications': 'Aucune notification', 'Encrypted locally': 'Chiffré localement', 'Add new task': 'Ajouter une tâche', 'Add task': 'Ajouter la tâche', 'New item': 'Nouvel élément', 'New view': 'Nouvelle vue', 'Edit view': 'Modifier la vue', 'Save view': 'Enregistrer la vue', Cancel: 'Annuler', Delete: 'Supprimer', 'Delete view': 'Supprimer la vue', Active: 'Actifs', Completed: 'Terminés', 'Auto closed': 'Fermés automatiquement', Cancelled: 'Annulés', Archived: 'Archivés', 'Recurring items': 'Éléments récurrents', 'No recurring items yet.': 'Aucun élément récurrent.', 'No items match this view.': 'Aucun élément ne correspond à cette vue.', 'Everything is clear': 'Tout est clair', 'View details': 'Détails de la vue', 'Move your data': 'Déplacer vos données', 'Encrypted Transfer': 'Transfert chiffré', 'Export all…': 'Tout exporter…', 'Import data…': 'Importer des données…', 'Request permission': 'Demander l’autorisation', 'Custom fields': 'Champs personnalisés', '+ Add': '+ Ajouter', 'No custom fields yet.': 'Aucun champ personnalisé.', Version: 'Version', Released: 'Publication', Schema: 'Schéma', Items: 'Éléments', 'Workspace ID': 'ID de l’espace', 'Interface language': 'Langue de l’interface', 'Choose the language used by the app on this device. Item titles and your data are never translated.': 'Choisissez la langue de l’application sur cet appareil. Les titres et vos données ne sont jamais traduits.', Language: 'Langue', 'Build your own system': 'Créez votre propre système', 'Unlock your workspace': 'Déverrouillez votre espace', 'Workspace name': 'Nom de l’espace', Password: 'Mot de passe', 'Confirm password': 'Confirmer le mot de passe', Unlock: 'Déverrouiller', 'Create encrypted workspace': 'Créer un espace chiffré', 'Working…': 'Traitement…', 'Already have an encrypted workspace?': 'Vous avez déjà un espace chiffré ?', 'Import .utm': 'Importer .utm', 'Opening encrypted workspace…': 'Ouverture de l’espace chiffré…', 'System metadata': 'Métadonnées système', 'Item JSON': 'JSON de l’élément', 'View JSON': 'JSON de la vue', 'DSL expression': 'Expression DSL', 'Sort DSL': 'Tri DSL', 'Displayed fields': 'Champs affichés', Renderer: 'Affichage', Sorting: 'Tri', 'Visual condition': 'Condition visuelle', Field: 'Champ', Operator: 'Opérateur', Value: 'Valeur', Title: 'Titre', Description: 'Description', Status: 'État', Priority: 'Priorité', Tags: 'Étiquettes', Contexts: 'Contextes', 'Dates & time': 'Date et heure', Reminders: 'Rappels', 'Scheduled start': 'Début planifié', 'Scheduled end': 'Fin planifiée', Deadline: 'Échéance', Timezone: 'Fuseau horaire', 'Estimated duration': 'Durée estimée', 'Actual duration': 'Durée réelle', 'All day': 'Toute la journée', None: 'Aucune', Low: 'Faible', Medium: 'Moyenne', High: 'Haute', Urgent: 'Urgente', Task: 'Tâche', Event: 'Événement', Habit: 'Habitude', Blank: 'Vide', 'Save item': 'Enregistrer l’élément', Calendar: 'Calendrier', Today: 'Aujourd’hui', 'Calendar settings': 'Réglages du calendrier', 'Show weekends': 'Afficher les week-ends', 'No automations yet': 'Aucune automatisation', 'Execution log': 'Journal d’exécution', Enable: 'Activer', Disable: 'Désactiver', Edit: 'Modifier',
  },
  ko: {
    Home: '홈', 'All items': '모든 항목', Settings: '설정', Lock: '잠금', Transfer: '전송', Notifications: '알림', 'No notifications': '알림 없음', 'Encrypted locally': '로컬 암호화됨', 'Add new task': '새 작업 추가', 'Add task': '작업 추가', 'New item': '새 항목', 'New view': '새 보기', 'Edit view': '보기 편집', 'Save view': '보기 저장', Cancel: '취소', Delete: '삭제', 'Delete view': '보기 삭제', Active: '활성', Completed: '완료됨', 'Auto closed': '자동 종료됨', Cancelled: '취소됨', Archived: '보관됨', 'Recurring items': '반복 항목', 'No recurring items yet.': '반복 항목이 아직 없습니다.', 'No items match this view.': '이 보기에 맞는 항목이 없습니다.', 'Everything is clear': '모두 완료되었습니다', 'View details': '보기 세부 정보', 'Move your data': '데이터 이동', 'Encrypted Transfer': '암호화된 전송', 'Export all…': '모두 내보내기…', 'Import data…': '데이터 가져오기…', 'Request permission': '권한 요청', 'Custom fields': '사용자 지정 필드', '+ Add': '+ 추가', 'No custom fields yet.': '사용자 지정 필드가 없습니다.', Version: '버전', Released: '출시일', Schema: '스키마', Items: '항목', 'Workspace ID': '작업 공간 ID', 'Interface language': '인터페이스 언어', 'Choose the language used by the app on this device. Item titles and your data are never translated.': '이 기기에서 사용할 앱 언어를 선택하세요. 항목 제목과 데이터는 번역되지 않습니다.', Language: '언어', 'Build your own system': '나만의 시스템 만들기', 'Unlock your workspace': '작업 공간 잠금 해제', 'Workspace name': '작업 공간 이름', Password: '비밀번호', 'Confirm password': '비밀번호 확인', Unlock: '잠금 해제', 'Create encrypted workspace': '암호화된 작업 공간 만들기', 'Working…': '처리 중…', 'Already have an encrypted workspace?': '암호화된 작업 공간이 이미 있나요?', 'Import .utm': '.utm 가져오기', 'Opening encrypted workspace…': '암호화된 작업 공간 여는 중…', 'System metadata': '시스템 메타데이터', 'Item JSON': '항목 JSON', 'View JSON': '보기 JSON', 'DSL expression': 'DSL 표현식', 'Sort DSL': 'DSL 정렬', 'Displayed fields': '표시 필드', Renderer: '표현 방식', Sorting: '정렬', 'Visual condition': '시각 조건', Field: '필드', Operator: '연산자', Value: '값', Title: '제목', Description: '설명', Status: '상태', Priority: '우선순위', Tags: '태그', Contexts: '컨텍스트', 'Dates & time': '날짜 및 시간', Reminders: '미리 알림', 'Scheduled start': '예정 시작', 'Scheduled end': '예정 종료', Deadline: '마감일', Timezone: '시간대', 'Estimated duration': '예상 소요 시간', 'Actual duration': '실제 소요 시간', 'All day': '하루 종일', None: '없음', Low: '낮음', Medium: '보통', High: '높음', Urgent: '긴급', Task: '작업', Event: '이벤트', Habit: '습관', Blank: '비어 있음', 'Save item': '항목 저장', Calendar: '캘린더', Today: '오늘', 'Calendar settings': '캘린더 설정', 'Show weekends': '주말 표시', 'No automations yet': '자동화가 아직 없습니다', 'Execution log': '실행 로그', Enable: '사용', Disable: '사용 안 함', Edit: '편집',
  },
};

common.es['Add new item'] = 'Añadir nuevo elemento';
common.de['Add new item'] = 'Neues Element hinzufügen';
common.fr['Add new item'] = 'Ajouter un nouvel élément';
common.ko['Add new item'] = '새 항목 추가';

const onboarding: Record<Exclude<WorkspaceLanguage, 'en'>, Dictionary> = {
  ru: {
    'Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.': 'Ваши данные остаются на этом устройстве в зашифрованном виде. Здесь нет аккаунта и восстановления пароля. Пожалуйста, запомните пароль.',
    'Install on your phone': 'Установить на телефон', 'iPhone or iPad:': 'iPhone или iPad:', 'open this page in Safari, tap Share, then choose': 'откройте эту страницу в Safari, нажмите «Поделиться», затем выберите', 'Add to Home Screen': '«На экран Домой»', 'Android:': 'Android:', 'open it in Chrome, tap the menu, then choose': 'откройте страницу в Chrome, нажмите меню, затем выберите', 'Install app': '«Установить приложение»', or: 'или', 'Add to Home screen': '«Добавить на главный экран»', 'Each device has its own encrypted workspace. Use an encrypted': 'На каждом устройстве создаётся своё зашифрованное пространство. Используйте зашифрованный файл', 'transfer file to move or merge your data between devices.': 'для переноса или объединения данных между устройствами.',
  },
  es: {
    'Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.': 'Tus datos permanecen cifrados en este dispositivo. No hay cuenta ni recuperación de contraseña. Recuerda tu contraseña.',
    'Install on your phone': 'Instalar en tu teléfono', 'iPhone or iPad:': 'iPhone o iPad:', 'open this page in Safari, tap Share, then choose': 'abre esta página en Safari, toca Compartir y elige', 'Add to Home Screen': 'Añadir a pantalla de inicio', 'Android:': 'Android:', 'open it in Chrome, tap the menu, then choose': 'ábrela en Chrome, toca el menú y elige', 'Install app': 'Instalar aplicación', or: 'o', 'Add to Home screen': 'Añadir a pantalla de inicio', 'Each device has its own encrypted workspace. Use an encrypted': 'Cada dispositivo tiene su propio espacio cifrado. Usa un archivo cifrado', 'transfer file to move or merge your data between devices.': 'para mover o combinar tus datos entre dispositivos.',
  },
  de: {
    'Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.': 'Deine Daten bleiben verschlüsselt auf diesem Gerät. Es gibt kein Konto und keine Passwortwiederherstellung. Bitte merke dir dein Passwort.',
    'Install on your phone': 'Auf dem Smartphone installieren', 'iPhone or iPad:': 'iPhone oder iPad:', 'open this page in Safari, tap Share, then choose': 'öffne diese Seite in Safari, tippe auf Teilen und wähle', 'Add to Home Screen': 'Zum Home-Bildschirm', 'Android:': 'Android:', 'open it in Chrome, tap the menu, then choose': 'öffne sie in Chrome, tippe auf das Menü und wähle', 'Install app': 'App installieren', or: 'oder', 'Add to Home screen': 'Zum Startbildschirm hinzufügen', 'Each device has its own encrypted workspace. Use an encrypted': 'Jedes Gerät hat seinen eigenen verschlüsselten Arbeitsbereich. Verwende eine verschlüsselte', 'transfer file to move or merge your data between devices.': 'Datei, um Daten zwischen Geräten zu übertragen oder zusammenzuführen.',
  },
  fr: {
    'Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.': 'Vos données restent chiffrées sur cet appareil. Il n’y a ni compte ni récupération de mot de passe. Gardez bien votre mot de passe.',
    'Install on your phone': 'Installer sur votre téléphone', 'iPhone or iPad:': 'iPhone ou iPad :', 'open this page in Safari, tap Share, then choose': 'ouvrez cette page dans Safari, touchez Partager puis choisissez', 'Add to Home Screen': 'Sur l’écran d’accueil', 'Android:': 'Android :', 'open it in Chrome, tap the menu, then choose': 'ouvrez-la dans Chrome, touchez le menu puis choisissez', 'Install app': 'Installer l’application', or: 'ou', 'Add to Home screen': 'Ajouter à l’écran d’accueil', 'Each device has its own encrypted workspace. Use an encrypted': 'Chaque appareil possède son propre espace chiffré. Utilisez un fichier chiffré', 'transfer file to move or merge your data between devices.': 'pour transférer ou fusionner vos données entre appareils.',
  },
  ko: {
    'Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.': '데이터는 이 기기에 암호화된 상태로 저장됩니다. 계정과 비밀번호 복구 기능은 없습니다. 비밀번호를 꼭 기억하세요.',
    'Install on your phone': '휴대폰에 설치', 'iPhone or iPad:': 'iPhone 또는 iPad:', 'open this page in Safari, tap Share, then choose': 'Safari에서 이 페이지를 열고 공유를 누른 다음 선택하세요', 'Add to Home Screen': '홈 화면에 추가', 'Android:': 'Android:', 'open it in Chrome, tap the menu, then choose': 'Chrome에서 열고 메뉴를 누른 다음 선택하세요', 'Install app': '앱 설치', or: '또는', 'Add to Home screen': '홈 화면에 추가', 'Each device has its own encrypted workspace. Use an encrypted': '각 기기에는 별도의 암호화된 작업 공간이 있습니다. 암호화된', 'transfer file to move or merge your data between devices.': '파일을 사용해 기기 간 데이터를 이동하거나 병합하세요.',
  },
};

const extraTranslations: Record<Exclude<WorkspaceLanguage, 'en'>, Dictionary> = {
  ru: {},
  es: {
    'Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.': 'La transferencia cifrada permite combinar todo el espacio de forma segura. Las exportaciones legibles usan las mismas reglas de vista previa, adición y copia al importar.',
    'Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.': 'Los recordatorios locales aparecen mientras la aplicación está abierta. La entrega en segundo plano usa Web Push opcional y el plan gratuito de Cloudflare comprueba los avisos cada 15 minutos.',
    'Background notifications': 'Notificaciones en segundo plano', 'Off — reminders stay only on this device while the app is open.': 'Desactivadas: los recordatorios solo permanecen en este dispositivo con la aplicación abierta.', 'Enable background delivery': 'Activar entrega en segundo plano', 'Backups are manual in this web app': 'Las copias de seguridad se crean manualmente en esta aplicación web', 'Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.': 'Los navegadores y iOS no permiten que una PWA escriba copias cifradas en silencio en una carpeta elegida. Elige una carpeta en Archivos al exportar y sustituye allí la copia anterior.', 'Planning & attention': 'Planificación y atención', Trash: 'Papelera',
  },
  de: {
    'Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.': 'Die verschlüsselte Übertragung ist sicher für das vollständige Zusammenführen des Arbeitsbereichs. Lesbare Exporte verwenden beim Import dieselben Vorschau-, Hinzufüge- und Kopierregeln.',
    'Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.': 'Lokale Erinnerungen erscheinen, solange die App geöffnet ist. Die Hintergrundzustellung nutzt optional Web Push; der kostenlose Cloudflare-Tarif prüft fällige Aufgaben alle 15 Minuten.',
    'Background notifications': 'Hintergrundbenachrichtigungen', 'Off — reminders stay only on this device while the app is open.': 'Aus — Erinnerungen bleiben nur auf diesem Gerät, solange die App geöffnet ist.', 'Enable background delivery': 'Hintergrundzustellung aktivieren', 'Backups are manual in this web app': 'Backups werden in dieser Web-App manuell erstellt', 'Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.': 'Browser und iOS erlauben einer PWA nicht, verschlüsselte Backups unbemerkt in einen ausgewählten Ordner zu schreiben. Wähle beim Export einen Ordner in Dateien und ersetze dort die vorherige Kopie.', 'Planning & attention': 'Planung und Aufmerksamkeit', Trash: 'Papierkorb',
  },
  fr: {
    'Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.': 'Le transfert chiffré permet de fusionner tout l’espace en sécurité. Les exports lisibles utilisent les mêmes règles d’aperçu, d’ajout et de copie à l’import.',
    'Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.': 'Les rappels locaux apparaissent lorsque l’application est ouverte. La livraison en arrière-plan utilise Web Push en option et le forfait Cloudflare gratuit vérifie les échéances toutes les 15 minutes.',
    'Background notifications': 'Notifications en arrière-plan', 'Off — reminders stay only on this device while the app is open.': 'Désactivées — les rappels restent sur cet appareil lorsque l’application est ouverte.', 'Enable background delivery': 'Activer la livraison en arrière-plan', 'Backups are manual in this web app': 'Les sauvegardes sont manuelles dans cette application web', 'Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.': 'Les navigateurs et iOS ne permettent pas à une PWA d’écrire silencieusement des sauvegardes chiffrées dans un dossier choisi. Choisissez un dossier dans Fichiers lors de l’export, puis remplacez-y la sauvegarde précédente.', 'Planning & attention': 'Planification et attention', Trash: 'Corbeille',
  },
  ko: {
    'Encrypted Transfer is safe for complete workspace merge. Readable exports use the same preview, add and copy rules on import.': '암호화된 전송은 전체 작업 공간을 안전하게 병합합니다. 읽을 수 있는 내보내기는 가져올 때 동일한 미리보기, 추가 및 복사 규칙을 사용합니다.',
    'Local reminders appear while the app is open. Background delivery uses optional Web Push and the free Cloudflare plan checks due jobs every 15 minutes.': '앱이 열려 있는 동안 로컬 알림이 표시됩니다. 백그라운드 전송은 선택적 Web Push를 사용하며 무료 Cloudflare 요금제는 15분마다 기한 알림을 확인합니다.',
    'Background notifications': '백그라운드 알림', 'Off — reminders stay only on this device while the app is open.': '끔 — 앱이 열려 있을 때만 이 기기에 알림이 남습니다.', 'Enable background delivery': '백그라운드 전송 사용', 'Backups are manual in this web app': '이 웹 앱의 백업은 수동으로 생성됩니다', 'Browsers and iOS do not allow a PWA to silently write encrypted backups into a user-selected folder. Choose a folder in Files when exporting, then replace the previous backup there.': '브라우저와 iOS에서는 PWA가 선택한 폴더에 암호화 백업을 몰래 저장할 수 없습니다. 내보낼 때 파일 앱에서 폴더를 선택한 뒤 이전 백업을 교체하세요.', 'Planning & attention': '계획 및 집중', Trash: '휴지통',
  },
};

// Settings and the view editor are deliberately descriptive. Keep these
// strings together so additions do not silently fall back to English in one
// of the supported interface languages.
Object.assign(extraTranslations.ru, {
  Theme: 'Тема', 'Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.': 'Выберите светлую, тёмную или системную тему. Режим по расписанию переключается в указанное время.',
  System: 'Системная', Light: 'Светлая', Dark: 'Тёмная', Scheduled: 'По расписанию', 'Interface sounds': 'Звуки интерфейса', 'Play calm sounds for buttons and controls': 'Воспроизводить спокойные звуки для кнопок и элементов управления', 'Completion sound': 'Звук завершения', 'Play a short sound when an item is completed': 'Воспроизводить короткий звук при завершении элемента',
  'Accelerated day': 'Ускоренный день', 'Optional local test clock. When enabled, one simulated day passes in the selected number of real seconds. It affects recurrence and active-range checks only on this device.': 'Дополнительные локальные тестовые часы. При включении один виртуальный день проходит за выбранное число реальных секунд. Они влияют на повторы и активные диапазоны только на этом устройстве.',
  'Enable accelerated test clock': 'Включить ускоренные тестовые часы', 'Seconds per simulated day': 'Секунд на виртуальный день', 'Defaults for new items': 'Значения по умолчанию для новых элементов', 'Pinned values are copied only when this view creates a new item. They never change the filter or existing items.': 'Закреплённые значения копируются только при создании нового элемента из этого вида. Они не меняют фильтр или существующие элементы.',
  'SQL-like filter': 'SQL-подобный фильтр', 'Build the filter with ordinary rows. The SQL-like field stays synchronized.': 'Соберите фильтр обычными строками. SQL-подобное поле синхронизируется автоматически.', Where: 'Где', Join: 'Связка', 'First rule': 'Первое условие', Property: 'Свойство', 'No value needed': 'Значение не нужно', 'The visual rules and SQL-like filter are synchronized.': 'Визуальные условия и SQL-подобный фильтр синхронизированы.',
  'Enabled for this encrypted workspace copy.': 'Включено для этой зашифрованной копии пространства.', Disable: 'Выключить', 'Allow local notifications': 'Разрешить локальные уведомления', 'Lock-screen content': 'Содержимое экрана блокировки', 'Generic — no task title leaves this device': 'Обычное — название задачи не покидает устройство', 'Show task title and urgency': 'Показывать название задачи и срочность',
  'BACKUP SCHEDULE': 'РАСПИСАНИЕ РЕЗЕРВНОГО КОПИРОВАНИЯ', 'Backup reminders': 'Напоминания о резервной копии', 'Choose how often the app should remind you to export an encrypted .utmb backup. The browser will not write to a folder by itself.': 'Выберите, как часто приложение должно напоминать о сохранении зашифрованной копии .utmb. Браузер не может сам записывать её в папку.', 'Remind every (days; 0 disables)': 'Напоминать каждые (дни; 0 — выключить)', 'Backup location note (optional)': 'Заметка о папке для копии (необязательно)', 'Create encrypted backup now': 'Создать зашифрованную копию сейчас', 'Last backup:': 'Последняя копия:',
});
Object.assign(extraTranslations.ru, {
  APPEARANCE: 'ОФОРМЛЕНИЕ', INTERFACE: 'ИНТЕРФЕЙС', DIAGNOSTICS: 'ДИАГНОСТИКА', 'DEVICE UNLOCK': 'РАЗБЛОКИРОВКА УСТРОЙСТВА',
  RECOVERY: 'ВОССТАНОВЛЕНИЕ', COMPATIBILITY: 'СОВМЕСТИМОСТЬ', 'LOCAL WORKSPACE': 'ЛОКАЛЬНОЕ ПРОСТРАНСТВО',
  'PARA ORGANIZATION': 'ОРГАНИЗАЦИЯ PARA', 'PARA organization': 'Организация PARA', 'IF → THEN, LOCALLY': 'ЕСЛИ → ТО, ЛОКАЛЬНО',
  'TIME, WITHOUT SILOS': 'ВРЕМЯ БЕЗ РАЗРЫВОВ', GUIDANCE: 'ПОДСКАЗКИ', SOUND: 'ЗВУК', TESTING: 'ТЕСТИРОВАНИЕ',
  EVERYTHING: 'ВСЕ ЭЛЕМЕНТЫ', BETA: 'БЕТА', Beta: 'Бета', 'Beta version': 'Бета-версия',
  Actions: 'Действия', Automations: 'Автоматизации', 'Automation rule': 'Правило автоматизации',
  '+ New automation': '+ Новая автоматизация', '+ Add item': '+ Добавить элемент', '+ Add reminder': '+ Добавить напоминание',
  '+ Add computed field': '+ Добавить вычисляемое поле', '+ Add link': '+ Добавить ссылку', '+ Add sort rule': '+ Добавить правило сортировки',
  '+ Add AND rule': '+ Добавить условие И', '+ Add OR rule': '+ Добавить условие ИЛИ', '+ Pin property': '+ Закрепить свойство',
  Add: 'Добавить', Apply: 'Применить', Save: 'Сохранить', Close: 'Закрыть', Clear: 'Очистить', Download: 'Скачать', Restore: 'Восстановить',
  Remove: 'Удалить', Rename: 'Переименовать', Reorder: 'Изменить порядок', Undo: 'Отменить', Open: 'Открыть', Hide: 'Скрыть',
  'Hide all': 'Скрыть всё', Optional: 'Необязательно', Details: 'Подробности', Notes: 'Заметки', Content: 'Содержимое',
  True: 'Да', False: 'Нет', Boolean: 'Логическое', Number: 'Число', Text: 'Текст', Counter: 'Счётчик', Percent: 'Проценты',
  Daily: 'Ежедневно', Weekly: 'Еженедельно', Monthly: 'Ежемесячно', Yearly: 'Ежегодно', Days: 'Дни', Hours: 'Часы', Minutes: 'Минуты', Seconds: 'Секунды', Weeks: 'Недели',
  First: 'Первый', Last: 'Последний', Never: 'Никогда', Overdue: 'Просрочено', Scheduled: 'Запланировано', Unscheduled: 'Без даты', Started: 'Запущен', Opened: 'Открыто',
  '1 hour': '1 час', '2 hours': '2 часа', '3 hours': '3 часа', '5 hours': '5 часов', '3 days': '3 дня', '15 min': '15 мин', '30 min': '30 мин', '45 min': '45 мин',
  'All active + completed': 'Все активные и завершённые', 'Any closed': 'Любое закрытое', 'Any path, e.g. custom.client': 'Любой путь, например custom.client',
  'Add Area': 'Добавить область', 'Add Area…': 'Добавить область…', 'Add Project': 'Добавить проект', 'Add Tag': 'Добавить тег',
  'Add a tag and press Enter': 'Введите тег и нажмите Enter', 'Choose Area…': 'Выберите область…', 'Choose Project…': 'Выберите проект…',
  'Choose or create an Area': 'Выберите или создайте область', 'Choose or create a Project': 'Выберите или создайте проект',
  'Choose or type an Area': 'Выберите или введите область', 'Choose or type a Project': 'Выберите или введите проект',
  'Choose or type a list': 'Выберите или введите список', 'Choose or type comma-separated values': 'Выберите или введите значения через запятую',
  'Choose related item…': 'Выберите связанный элемент…', 'No Area': 'Без области', 'No Tags': 'Без тегов', 'No list': 'Без списка',
  Organization: 'Организация', 'Areas, Projects and Tags': 'Области, проекты и теги', 'Area, Project & list': 'Область, проект и список',
  'Area:': 'Область:', 'Project:': 'Проект:', 'List:': 'Список:', 'Project name': 'Название проекта',
  'New Project without Area': 'Новый проект без области', 'New Project in': 'Новый проект в', 'New tag': 'Новый тег',
  'Rename Area': 'Переименовать область', 'Rename Project': 'Переименовать проект', 'Rename Tag': 'Переименовать тег',
  'New name for Area': 'Новое название области', 'New name for Project': 'Новое название проекта', 'New name for Tag': 'Новое название тега',
  'Unified priority': 'Общий приоритет', 'Apply / Save order': 'Применить / сохранить порядок', 'Reset order': 'Сбросить порядок',
  'Order has unsaved changes': 'В порядке есть несохранённые изменения', 'Order is saved': 'Порядок сохранён',
  'Organization order — unified Area, Project & Tag priority': 'Порядок организации — общий приоритет областей, проектов и тегов',
  'Area order — legacy manual order': 'Порядок областей — старый ручной порядок', 'Project order — legacy manual order': 'Порядок проектов — старый ручной порядок',
  'Tag order — legacy manual order': 'Порядок тегов — старый ручной порядок', 'List order — priority, then newest': 'Порядок списка — сначала приоритет, затем новые',
  'Projects are repeated under every linked Area. The highest matching occurrence wins; every row remains draggable.': 'Проект показывается в каждой связанной области. Учитывается самое высокое положение, а любую строку можно перетащить.',
  'Rules are applied in this order. Organization order uses the highest matching Area-scoped Project occurrence, Area fallback or Tag in the unified Settings ladder. Legacy orders remain available for existing Views.': 'Правила применяются по порядку. Общий порядок организации учитывает самое высокое положение проекта в области, самой области или тега. Старые варианты порядка остаются доступны для существующих видов.',
  'Rules run from top to bottom. Later rules break ties from earlier ones.': 'Правила выполняются сверху вниз. Следующие правила разрешают совпадения предыдущих.',
  'Edit item': 'Редактировать элемент', 'Complete item': 'Завершить элемент', 'Reopen item': 'Открыть элемент снова',
  'Complete habit today': 'Отметить привычку сегодня', 'Undo habit completion today': 'Отменить отметку привычки сегодня',
  'Convert item to Project': 'Преобразовать элемент в проект', 'Item will be kept in this Project': 'Элемент останется в этом проекте',
  'New subtask title': 'Название новой подзадачи', 'Add subtask': 'Добавить подзадачу', 'Remove subtask': 'Удалить подзадачу',
  'This item is a subtask': 'Этот элемент является подзадачей', 'Parent:': 'Родитель:', 'Linked item:': 'Связанный элемент:',
  'Linking items': 'Связи элементов', 'Add link': 'Добавить ссылку', 'Remove link': 'Удалить ссылку', 'Remove relation': 'Удалить связь',
  'Add existing items as steps of this item. Subtasks remain independent universal items and can be completed or edited on their own.': 'Добавляйте существующие элементы как шаги. Подзадачи остаются самостоятельными элементами: их можно отдельно завершать и редактировать.',
  'Relations connect two items without making either one a subtask. Links are URL references only; files are not stored in this workspace.': 'Связь соединяет два элемента, не превращая их в подзадачи. Ссылки содержат только URL; файлы в пространстве не хранятся.',
  'Context, links, checklists…': 'Контекст, ссылки, чек-листы…', 'What needs to happen?': 'Что нужно сделать?',
  'Custom field': 'Пользовательское поле', 'Custom field path': 'Путь пользовательского поля', 'Add path': 'Добавить путь',
  'Add computed fields to this item. Expressions look like JavaScript, but run in a safe read-only engine: no': 'Добавляйте вычисляемые поля. Выражения похожи на JavaScript, но выполняются в безопасном режиме только для чтения: без',
  'Show in results': 'Показывать в результатах', 'Save field': 'Сохранить поле', 'Save fields': 'Сохранить поля',
  'Formula DSL': 'DSL-формула', 'Actions, results and error log': 'Действия, результаты и журнал ошибок',
  'Actual completion or cancellation': 'Фактическое завершение или отмена', 'Completed on': 'Завершено', 'Completion time': 'Время завершения',
  Cycle: 'Цикл', 'Next activation': 'Следующая активация', 'Next period': 'Следующий период', 'Previous period': 'Предыдущий период',
  'Progress versus habit': 'Прогресс и привычка', 'Simple habit stopwatch': 'Простой секундомер привычки', Start: 'Старт', Stop: 'Стоп',
  'No completion dates yet.': 'Дат выполнения пока нет.', 'Progress describes the current item. A habit stays one item and records completed calendar dates instead of creating a duplicate item for every day.': 'Прогресс описывает текущий элемент. Привычка остаётся одним элементом и записывает даты выполнения, не создавая копию на каждый день.',
});
Object.assign(extraTranslations.ru, {
  'View templates': 'Шаблоны видов', 'View template': 'Шаблон вида', Template: 'Шаблон', Templates: 'Шаблоны', 'Template name': 'Название шаблона',
  'Choose a saved template': 'Выберите сохранённый шаблон', 'Apply template': 'Применить шаблон', 'Save as template': 'Сохранить как шаблон',
  'Import as template': 'Импортировать как шаблон', 'No templates yet.': 'Шаблонов пока нет.', 'Untitled template': 'Шаблон без названия',
  'Pick a template to prefill this new item. Nothing changes until you select one, and you can edit every field before saving.': 'Выберите шаблон для заполнения нового элемента. Пока шаблон не выбран, ничего не меняется; перед сохранением можно изменить любое поле.',
  'Templates are kept in the same workspace but do not appear in ordinary lists. They can be selected only while creating a new item.': 'Шаблоны хранятся в этом пространстве, но не появляются в обычных списках. Их можно выбрать только при создании нового элемента.',
  'Visual setup': 'Визуальная настройка', '1. Filter items': '1. Фильтр элементов', 'Advanced filter code': 'Расширенный код фильтра',
  'Display fields': 'Отображаемые поля', 'Display order': 'Порядок отображения', 'Board columns': 'Колонки доски',
  'Sort field': 'Поле сортировки', 'Sort direction': 'Направление сортировки', 'Empty values': 'Пустые значения', Ascending: 'По возрастанию', Descending: 'По убыванию',
  'Custom expression…': 'Своё выражение…', 'Custom sort expression': 'Своё выражение сортировки', 'Custom — edit expression below': 'Своё — измените выражение ниже',
  'Default view color': 'Цвет вида по умолчанию', 'Custom view color': 'Свой цвет вида', 'View color': 'Цвет вида',
  'This color identifies the view and completed ticks. Each option stays readable in light and dark themes.': 'Цвет выделяет вид и отметки выполнения. Все варианты читаемы в светлой и тёмной теме.',
  'A view is a saved, live list; it never copies items.': 'Вид — это сохранённый живой список; он не копирует элементы.',
  'Use the visual setup below: first choose which items appear, then choose what is shown for each item.': 'Сначала выберите, какие элементы попадут в вид, затем — какие их поля показывать.',
  'An empty filter means all items except recurring source templates. Sorting only controls order.': 'Пустой фильтр показывает все элементы, кроме исходных шаблонов повторов. Сортировка меняет только порядок.',
  'The optional advanced filter code below is synchronized with ordinary rows whenever its logic can be represented visually.': 'Расширенный код фильтра синхронизируется с обычными строками, когда его условия можно представить визуально.',
  'Build the filter with ordinary fields, operators and values. The result and advanced code update immediately. Active range uses Event opens through Due.': 'Соберите фильтр из полей, операторов и значений. Результат и расширенный код обновятся сразу. Активный диапазон идёт от начала события до срока.',
  'The visual rows and advanced filter code are synchronized.': 'Визуальные строки и расширенный код фильтра синхронизированы.',
  'This filter uses advanced code that cannot be shown as ordinary rows. Adding a visual rule replaces that code.': 'Этот фильтр использует сложный код, который нельзя показать обычными строками. Добавление визуального условия заменит этот код.',
  'Choose the columns or details shown for every matching item. This does not change which items match; their order is the display order.': 'Выберите поля, показываемые у подходящих элементов. Это не влияет на отбор; порядок здесь задаёт порядок отображения.',
  'Drag a field to change its order, or hide it with ×.': 'Перетащите поле, чтобы изменить порядок, или скройте его кнопкой ×.',
  'Select fields below to preview them here.': 'Выберите поля ниже, чтобы увидеть пример.', 'Definitions use JSON. Results can also be opened in spreadsheets or calendar apps.': 'Определения используют JSON. Результаты можно открыть в таблицах или календарях.',
  'Definition JSON': 'JSON определения', 'Definition + results Excel': 'Определение и результаты Excel', 'Export view': 'Экспортировать вид', 'Export…': 'Экспорт…',
  'This is the complete SavedView draft. Imported JSON is applied as a template and keeps this view ID.': 'Это полный черновик SavedView. Импортированный JSON применяется как шаблон и сохраняет ID этого вида.',
  'This uses the same SavedView field model as every other view.': 'Здесь используется та же модель полей SavedView, что и во всех других видах.',
  'Group items by status or by tag. Empty columns are hidden by default.': 'Группируйте элементы по статусу или тегу. Пустые колонки по умолчанию скрыты.',
  'Each existing tag becomes a column automatically. Items without tags appear in “No tags”. Add or remove tags on items to change the columns.': 'Каждый существующий тег автоматически становится колонкой. Элементы без тегов попадают в «Без тегов». Добавляйте или удаляйте теги у элементов, чтобы менять колонки.',
  'Matching items have no dates.': 'У подходящих элементов нет дат.', 'No items match this board.': 'Нет элементов, соответствующих этой доске.',
  'Manual order': 'Ручной порядок', 'Drag to set a manual order. Use arrow keys for precise movement.': 'Перетащите для ручного порядка. Для точного перемещения используйте стрелки.',
  Customize: 'Настроить', 'Customize all items': 'Настроить все элементы', 'Choose the item properties shown in All items. Status sections and Trash keep their current layout.': 'Выберите поля, показываемые во «Всех элементах». Разделы статусов и корзина сохранят текущий вид.',
  'Useful system collections. An item can appear here and in its status section; custom categories will come later through Views.': 'Полезные системные подборки. Элемент может быть одновременно здесь и в разделе своего статуса; собственные категории создаются через виды.',
  'Deleted items stay here until you restore them.': 'Удалённые элементы остаются здесь, пока вы их не восстановите.', 'Trash is empty.': 'Корзина пуста.',
  'Clear trash': 'Очистить корзину', 'Delete permanently': 'Удалить навсегда', 'Permanently delete': 'Удалить навсегда', 'This cannot be undone.': 'Это действие нельзя отменить.',
  'Calendar view': 'Вид календаря', 'Calendar item states': 'Статусы элементов календаря', 'Calendar duration amount': 'Значение длительности календаря', 'Calendar duration unit': 'Единица длительности календаря',
  'New calendar item': 'Новый элемент календаря', 'Drag an item into the calendar.': 'Перетащите элемент в календарь.', 'Everything has a date.': 'У всех элементов есть дата.',
  'Set Event opens': 'Установить начало события', 'Set Due': 'Установить срок', 'Set Event opens first.': 'Сначала задайте начало события.',
  'Duration': 'Длительность', 'Duration preset': 'Готовая длительность', 'Choose a preset or type a value. Changes Event ends; Due stays unchanged.': 'Выберите готовое значение или введите своё. Изменится окончание события, срок останется прежним.',
  'Scheduled time': 'Запланированное время', 'Scheduled time reserves a calendar block. A deadline is the latest completion time. Availability only says how early work may begin.': 'Запланированное время резервирует блок календаря. Срок — самое позднее время завершения. Доступность лишь указывает, когда можно начать.',
  'The full 24-hour day stays available. Time between Sleep and Wake is shaded in the calendar.': 'Все 24 часа остаются доступными. Время между сном и пробуждением затемняется в календаре.',
  'Dark theme starts': 'Тёмная тема включается', 'Light theme starts': 'Светлая тема включается', 'Monday': 'Понедельник', 'Sunday': 'Воскресенье',
});
Object.assign(extraTranslations.ru, {
  'Face ID / Touch ID': 'Face ID / Touch ID', 'Enable Face ID': 'Включить Face ID', 'Disable Face ID': 'Выключить Face ID', 'Unlock with Face ID': 'Войти с Face ID',
  'Optional quick unlock for this device only. Face ID never replaces your password, and exports still require the password.': 'Быстрый вход только на этом устройстве. Face ID не заменяет пароль; пароль по-прежнему нужен для экспорта.',
  'Password unlock is always available, including if Face ID is unavailable, cancelled, or changes on this device.': 'Вход по паролю доступен всегда — даже если Face ID недоступен, отменён или изменился на устройстве.',
  'If Face ID fails, is cancelled, or the device changes, use the password field on the lock screen. Removing this option never removes your workspace.': 'Если Face ID не сработал, был отменён или устройство изменилось, используйте пароль. Отключение Face ID не удаляет пространство.',
  'Unavailable on this browser or device. Password unlock remains available.': 'Недоступно в этом браузере или на устройстве. Вход по паролю остаётся доступен.',
  'Create a local test workspace without password or encryption': 'Создать локальное тестовое пространство без пароля и шифрования',
  'Create unencrypted test workspace': 'Создать незашифрованное тестовое пространство',
  'Test mode: anyone with access to this browser profile can read these items. Do not use it for personal data, and do not rely on it as a backup.': 'Тестовый режим: любой пользователь этого профиля браузера сможет прочитать данные. Не храните здесь личные данные и не считайте это резервной копией.',
  'Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.': 'Данные остаются на устройстве в зашифрованном виде. Учётной записи и восстановления пароля нет — обязательно сохраните пароль.',
  'Choose backup file': 'Выбрать файл резервной копии', 'Choose another backup': 'Выбрать другую копию', 'Backup file': 'Файл резервной копии', 'Backup password': 'Пароль резервной копии',
  'Import selected backup': 'Импортировать выбранную копию', 'Importing…': 'Импорт…', 'Merge from backup': 'Объединить с копией',
  'Export encrypted .utmb': 'Экспортировать зашифрованный .utmb', 'Download offline recovery kit': 'Скачать автономный комплект восстановления',
  'Encrypted backup & transfer': 'Зашифрованная копия и перенос', 'Portable backup': 'Переносимая резервная копия', 'Encrypted local browser storage': 'Зашифрованное локальное хранилище браузера',
  'Every exported file is encrypted. Universal uses one': 'Каждый экспортируемый файл зашифрован. Universal использует единый',
  'format for transfer, recovery and restore.': 'формат для переноса, восстановления и возврата данных.',
  'Replace this device?': 'Заменить данные на этом устройстве?', 'Replace local workspace from backup': 'Заменить локальное пространство из копии',
  'This removes the current local workspace from this browser and restores the selected encrypted backup. The backup itself is not changed.': 'Текущее локальное пространство будет удалено из браузера и заменено выбранной зашифрованной копией. Сам файл копии не изменится.',
  'Workspace storage': 'Хранилище пространства', Storage: 'Хранилище', 'No previous workspace versions yet.': 'Предыдущих версий пространства пока нет.',
  'Universal keeps the two encrypted versions from before schema updates.': 'Universal хранит две зашифрованные версии, созданные перед обновлениями схемы.',
  'If this workspace cannot be opened, save its encrypted browser copy before clearing site data.': 'Если пространство не открывается, сохраните его зашифрованную копию из браузера до очистки данных сайта.',
  'No password is required. Workspace content stays encrypted; safe troubleshooting entries are included.': 'Пароль не требуется. Данные остаются зашифрованными; безопасная диагностика будет добавлена в файл.',
  'Offline emergency access:': 'Аварийный доступ без интернета:', 'No internet connection.': 'Нет подключения к интернету.',
  'Offline mode is active. You can still download the encrypted local database and troubleshooting log below; online hosting features are unavailable.': 'Включён автономный режим. Можно скачать зашифрованную локальную базу и журнал диагностики; сетевые функции недоступны.',
  'If the hosting site is unavailable': 'Если сайт недоступен', 'Add to Home Screen': 'На экран «Домой»', 'Add to Home screen': 'Добавить на главный экран', 'Install app': 'Установить приложение',
  'iPhone or iPad:': 'iPhone или iPad:', 'iPhone/iPad:': 'iPhone/iPad:', 'Android:': 'Android:', 'PC/Mac:': 'ПК/Mac:',
  Files: 'Файлы', Downloads: 'Загрузки', 'Files → Downloads': 'Файлы → Загрузки', 'On My iPhone/iPad': 'На iPhone/iPad',
  'Application startup failed:': 'Ошибка запуска приложения:', 'Preflight failed:': 'Предварительная проверка не пройдена:',
  'SAFE RECOVERY MODE': 'БЕЗОПАСНЫЙ РЕЖИМ ВОССТАНОВЛЕНИЯ', 'WORKSPACE UPDATE': 'ОБНОВЛЕНИЕ ПРОСТРАНСТВА',
  'Your workspace data is still available': 'Данные пространства по-прежнему доступны', 'This workspace was created by a newer app': 'Это пространство создано более новой версией приложения',
  'Update workspace': 'Обновить пространство', 'Target schema': 'Целевая схема', 'Compatible entities': 'Совместимые сущности', 'Needs repair': 'Требуется исправление',
  'Readable items (': 'Читаемые элементы (', 'Recurrence, scripts, automations, reminders, push and saved filters are disabled in this mode.': 'В этом режиме отключены повторы, скрипты, автоматизации, напоминания, push-уведомления и сохранённые фильтры.',
  'The original encrypted workspace will be saved as a rollback version before any migrated data is written.': 'Перед записью обновлённых данных будет сохранена исходная зашифрованная версия для отката.',
  'Universal will not downgrade or overwrite it. Download a copy or open recovery mode, then update the app.': 'Universal не будет понижать версию или перезаписывать данные. Скачайте копию либо откройте режим восстановления, затем обновите приложение.',
  'Record local diagnostics': 'Записывать локальную диагностику', 'Local diagnostics record operation names, results, durations and crashes without task content. Nothing is uploaded automatically.': 'Локальная диагностика записывает названия операций, результаты, длительность и сбои без содержимого задач. Ничего не отправляется автоматически.',
  'This local log is available before unlocking. It records operation names, timing and technical failures — never item titles, passwords, encryption keys or encrypted workspace data.': 'Этот журнал доступен до входа. Он записывает операции, время и технические ошибки, но никогда — названия элементов, пароли, ключи шифрования или данные пространства.',
  'Troubleshooting log (': 'Журнал диагностики (', 'Open navigation': 'Открыть меню', 'Main navigation': 'Главное меню',
  'Detailed explanations': 'Подробные пояснения', 'Show explanatory text and guides throughout the interface': 'Показывать пояснения и инструкции во всём интерфейсе',
  'Background delivery is checked about every 15 minutes on the free service, so it is not an exact alarm. GitHub only hosts the app files; it does not receive your workspace or notification list. When detailed lock-screen content is selected, the push service temporarily receives the task title, Start, Deadline and reminder urgency needed to send the notification.': 'Бесплатная служба проверяет фоновые уведомления примерно раз в 15 минут, поэтому это не точный будильник. GitHub хранит только файлы приложения и не получает пространство или список уведомлений. При подробном содержимом экрана блокировки push-служба временно получает название задачи, начало, срок и срочность напоминания.',
  'For iPhone, install Universal to the Home Screen, then enable this from the installed app. The Worker never receives your password or encrypted database.': 'На iPhone добавьте Universal на экран «Домой», откройте установленное приложение и включите эту функцию. Worker никогда не получает пароль или зашифрованную базу.',
});
Object.assign(extraTranslations.ru, {
  'Recurrence & auto-renew': 'Повторы и автообновление', 'RRULE — Recurrence Rule': 'RRULE — правило повторения', 'Schedule RRULE': 'Расписание RRULE',
  'Repeat frequency': 'Частота повторения', 'Repeat interval': 'Интервал повторения', 'Repeat on': 'Повторять по', 'Repeat on weekdays': 'Повторять по дням недели',
  'Advanced recurrence behavior': 'Расширенные настройки повторения', 'Entire series': 'Вся серия', 'This occurrence': 'Только это повторение', 'This and future': 'Это и будущие',
  'Which part of the series should move?': 'Какую часть серии переместить?', 'Move repeating item': 'Переместить повторяющийся элемент',
  'Choose one scope for the selected recurring items. You can move individual rows separately afterwards.': 'Выберите область действия для отмеченных повторов. Затем отдельные строки можно переместить независимо.',
  'A series is one source item; each cycle has its own history.': 'Серия — это один исходный элемент; каждый цикл имеет собственную историю.',
  'These are the recurrence source settings. Auto-renew keeps one live item and records finished cycles inside its Cycle history.': 'Это исходные настройки повторения. Автообновление сохраняет один активный элемент и записывает завершённые циклы в его историю.',
  'Finished auto-renew cycles stay inside this item. Its current Dates & time always describe the active or most recent cycle.': 'Завершённые циклы автообновления остаются внутри элемента. Текущие даты и время описывают активный или последний цикл.',
  'Most weekly tasks only need Repeat and, optionally, the active range. Advanced settings are for unusual activation and auto-close rules.': 'Для большинства еженедельных задач достаточно повтора и, при необходимости, активного диапазона. Расширенные настройки нужны для особой активации и автозакрытия.',
  'Count the selected interval from the actual completion time: days, weeks, months or years.': 'Отсчитывать выбранный интервал от фактического завершения: в днях, неделях, месяцах или годах.',
  'Choose actual completion when the next interval should be counted from the time you finished, rather than the original schedule.': 'Выберите фактическое завершение, если следующий интервал нужно отсчитывать от момента выполнения, а не от исходного расписания.',
  'Actual completion or cancellation': 'Фактическое завершение или отмена', 'At next activation': 'При следующей активации', 'Auto-close': 'Автозакрытие', 'Auto-close untouched cycles': 'Автоматически закрывать незатронутые циклы',
  'Activation amount': 'Значение активации', 'Activation unit': 'Единица активации', 'Active range ends': 'Конец активного диапазона',
  'Before Event opens': 'До начала события', 'After Event opens': 'После начала события', 'At due time': 'В момент срока', 'At time': 'В указанное время',
  'Complete once between Event opens and Due / Active range ends. Outside that range, no active item is shown. The opening date supplies the weekly cycle day.': 'Выполните один раз между началом события и сроком или концом активного диапазона. Вне диапазона активный элемент не показывается. Дата начала задаёт день еженедельного цикла.',
  'Notifications can happen before or at any important moment, independently of the scheduled time and deadline.': 'Напоминания могут срабатывать до или в любой важный момент независимо от запланированного времени и срока.',
  'Use more than one reminder when needed. Due reminders for the same item are shown as one card with a count. Closing the pop-up only hides it; deleting it from Notifications confirms those reminders so they do not return after the next unlock.': 'При необходимости добавьте несколько напоминаний. Наступившие напоминания одного элемента объединяются в карточку со счётчиком. Закрытие всплывающего окна только скрывает его; удаление из уведомлений подтверждает напоминания, и после следующего входа они не вернутся.',
  'How reminders behave': 'Как работают напоминания', 'How recurring items work': 'Как работают повторяющиеся элементы', 'How views work': 'Как работают виды',
  Reminder: 'Напоминание', 'Remove reminder': 'Удалить напоминание',
  Trigger: 'Триггер', 'Condition DSL': 'Условие DSL', 'Missed runs': 'Пропущенные запуски', 'Run each': 'Выполнить каждый', 'Run once': 'Выполнить один раз', Skip: 'Пропустить',
  'Create a safe rule for repetitive work.': 'Создайте безопасное правило для повторяющейся работы.', 'Rules can change your workspace, but cannot run code or access the network.': 'Правила могут изменять пространство, но не могут выполнять произвольный код или обращаться к сети.',
  'Runs will appear here.': 'Запуски появятся здесь.', 'Deleted rule': 'Правило удалено', 'Save rule': 'Сохранить правило', 'Remove script': 'Удалить скрипт',
  'Import preview': 'Предпросмотр импорта', 'Import in one transaction': 'Импортировать одной операцией', 'Import is blocked': 'Импорт заблокирован',
  'Import as new item': 'Импортировать как новый элемент', 'Copy with new ID': 'Копировать с новым ID', 'Rename imported': 'Переименовать импортированное', 'Use local': 'Использовать локальное',
  'ID already exists': 'ID уже существует', 'Custom field conflicts': 'Конфликты пользовательских полей', 'Compatibility notes (': 'Примечания о совместимости (',
  'Apply JSON': 'Применить JSON', 'Apply JSON to form': 'Применить JSON к форме', 'Refresh from form': 'Обновить из формы', 'Refresh from visual editor': 'Обновить из визуального редактора',
  'JSON safety': 'Безопасность JSON', 'Edit the same item draft as the form. Protected identity, provenance, timestamps and occurrence fields are preserved when updating an existing item.': 'Редактируется тот же черновик, что и в форме. При обновлении сохраняются защищённые поля идентичности, происхождения, времени и повторения.',
  'Apply JSON updates the form first; only Save item writes it to the workspace. Import as new item always creates a separate copy. Exported data is readable, so do not share it accidentally.': 'Применение JSON сначала обновляет форму; только «Сохранить элемент» записывает данные в пространство. Импорт как нового элемента всегда создаёт отдельную копию. Экспортированные данные читаемы — не передавайте их случайно.',
  'Relations, subtasks, item IDs, timestamps, completion history and occurrence identity cannot be copied into new items.': 'Связи, подзадачи, ID, временные метки, история выполнения и идентичность повторения не копируются в новые элементы.',
  'Item ID': 'ID элемента', 'Item schema': 'Схема элемента', 'Item status': 'Статус элемента', 'Application ID': 'ID приложения', 'Created by application': 'Создано приложением', 'Created at': 'Создано', 'Last modified': 'Изменено',
  'Main navigation': 'Главное меню', 'Close import preview': 'Закрыть предпросмотр импорта', 'Close notification center': 'Закрыть центр уведомлений', 'Close unscheduled items': 'Закрыть элементы без даты',
  'Current item:': 'Текущий элемент:', 'Untitled': 'Без названия', 'Untitled item': 'Элемент без названия', 'Name': 'Название', Label: 'Метка', Key: 'Ключ', Type: 'Тип', State: 'Состояние',
});
Object.assign(extraTranslations.ru, {
  Complete: 'Завершить', Deleted: 'Удалено', Due: 'Срок', In: 'В', Link: 'Ссылка', More: 'Ещё', 'More options': 'Дополнительные параметры',
  'Confirm delete': 'Подтвердить удаление', 'Contains data': 'Содержит данные', 'Manual only': 'Только вручную', 'Has deadline': 'Есть срок',
  'Comma-separated values': 'Значения через запятую', 'Choose…': 'Выберите…', 'Select all': 'Выбрать всё',
  'Create Task list': 'Создать список задач', 'Choose existing Task list': 'Выбрать существующий список задач', 'Or create a new list': 'Или создать новый список',
  'Move group': 'Переместить группу', 'Move selected items': 'Переместить выбранные элементы', 'Move selected…': 'Переместить выбранные…',
  'Set the new date and time for the earliest selected item. Every selected item keeps the same relative distance.': 'Установите новую дату и время для самого раннего выбранного элемента. Остальные сохранят относительный интервал.',
  'Calendar change saved': 'Изменение календаря сохранено', 'NO CHANGES YET': 'ИЗМЕНЕНИЙ ПОКА НЕТ', 'New item defaults:': 'Значения нового элемента:',
  'Default value for': 'Значение по умолчанию для', 'Property to pin for new items': 'Свойство для новых элементов', 'Remove default': 'Удалить значение по умолчанию',
  'Remove filter rule': 'Удалить условие фильтра', 'Remove sort': 'Удалить сортировку', 'Sorting examples': 'Примеры сортировки', 'Sort:': 'Сортировка:',
  'One rule per line. SQL preview:': 'Одно правило в строке. Предпросмотр SQL:', 'Optional text form of the visual rows. SQL preview:': 'Необязательная текстовая форма визуальных условий. Предпросмотр SQL:',
  'Compact countdown text:': 'Краткий текст обратного отсчёта:', 'Whole-number countdowns for Views:': 'Целочисленный обратный отсчёт для видов:',
  'Whole hours': 'Целые часы', 'Whole minutes': 'Целые минуты', 'Whole seconds': 'Целые секунды', 'Until sleep': 'До сна',
  'Adaptive: days → hours/minutes → seconds': 'Адаптивно: дни → часы/минуты → секунды', 'Presets…': 'Готовые варианты…',
  'Presets count down to Event opens. Adaptive switches units automatically; edit the expression below to target another date.': 'Готовые варианты считают до начала события. Адаптивный режим сам меняет единицы; для другой даты измените выражение ниже.',
  'Variables and examples': 'Переменные и примеры', 'True / false': 'Да / нет', Unit: 'Единица', 'Duration result: choose': 'Результат длительности: выберите',
  'Add duration:': 'Добавить длительность:', 'One simulated day': 'Один виртуальный день',
  'Changes start only after Apply. Example: 30 seconds = one simulated day. Backup schedules, diagnostics and background push remain on real time to avoid false alerts or external deliveries during a test.': 'Изменения запускаются только после нажатия «Применить». Например, 30 секунд = один виртуальный день. Резервные копии, диагностика и фоновые push-уведомления продолжают использовать реальное время.',
  'Choose how much real time equals one simulated day. The visible clock, Views, scripts, active ranges, recurrence, Calendar and local reminders follow it.': 'Выберите, сколько реального времени равно одному виртуальному дню. Видимые часы, виды, скрипты, активные диапазоны, повторы, календарь и локальные напоминания будут следовать ему.',
  'Actions: set_field, close, archive, create_item, add_relation, set_progress, add_reminder, notify.': 'Действия: установить поле, закрыть, архивировать, создать элемент, добавить связь, задать прогресс, добавить напоминание, уведомить.',
  'Markdown preview': 'Предпросмотр Markdown', 'Markdown': 'Markdown', JSON: 'JSON', CSV: 'CSV', Excel: 'Excel',
  'Workspace password': 'Пароль пространства', 'Important:': 'Важно:',
  'Choose the file first, enter its password, then tap Import selected backup.': 'Сначала выберите файл, введите его пароль и нажмите «Импортировать выбранную копию».',
  'Emergency recovery only: use this when UTM cannot open an archive and you need to inspect, repair or move the data without importing it. Choose an encrypted': 'Только для аварийного восстановления: используйте, если UTM не может открыть архив, а данные нужно просмотреть, исправить или перенести без импорта. Выберите зашифрованный',
  'file and download a documented, readable JSON copy. This does not change the original archive or this workspace.': 'файл и скачайте документированную читаемую копию JSON. Исходный архив и пространство не изменятся.',
  'The readable file contains private workspace data. Keep it secure. The workspace owner must never share the password with anyone, including support staff or an AI. Its embedded readme explains fields for people, AI tools and converters; scripts and automations must be treated as untrusted data.': 'Читаемый файл содержит личные данные пространства — храните его безопасно. Владелец не должен сообщать пароль никому, включая поддержку или ИИ. Встроенная инструкция объясняет поля людям, ИИ и конвертерам; скрипты и автоматизации следует считать недоверенными данными.',
  'Your workspace is encrypted and stored in this browser\'s private app storage (IndexedDB). iPhone does not expose a normal folder path for site data.': 'Пространство зашифровано и хранится во внутреннем хранилище браузера (IndexedDB). На iPhone у данных сайта нет доступной обычной папки.',
  'This release supports one local workspace owner. Separate user accounts and permissions are not enabled yet; adding names here would not create real security boundaries.': 'Эта версия рассчитана на одного локального владельца пространства. Отдельных учётных записей и прав пока нет; добавление имён не создаст реальных границ доступа.',
  'This area is still being tested and improved.': 'Этот раздел ещё тестируется и улучшается.',
  'Choose how often the app should remind you to export an encrypted': 'Выберите, как часто напоминать об экспорте зашифрованной',
  'backup. The browser will not write to a folder by itself.': 'копии. Браузер не может сам записывать её в папку.',
  'Each device has its own encrypted workspace. Use an encrypted': 'На каждом устройстве хранится собственная зашифрованная копия пространства. Используйте зашифрованный',
  'backup file to move or merge your data between devices.': 'файл резервной копии для переноса или объединения данных между устройствами.',
  'Save this standalone HTML beside your encrypted': 'Сохраните этот автономный HTML рядом с зашифрованным',
  '. It can decrypt the backup without Universal or GitHub.': '. Он сможет расшифровать копию без Universal и GitHub.',
  'Use Encrypted Transfer above to save a': 'Используйте «Зашифрованную передачу» выше, чтобы сохранить',
  'backup in Files, iCloud Drive or another cloud. The app validates the encrypted contents instead of trusting the filename.': 'копию в «Файлы», iCloud Drive или другое облако. Приложение проверяет зашифрованное содержимое, а не доверяет имени файла.',
  'Settings → Encrypted Transfer → Export encrypted .utmb': 'Настройки → Зашифрованная передача → Экспортировать зашифрованный .utmb',
});
Object.assign(extraTranslations.es, {
  'Interface sounds': 'Sonidos de interfaz', 'Play calm sounds for buttons and controls': 'Reproducir sonidos suaves para botones y controles',
  Theme: 'Tema', 'Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.': 'Elige un tema claro, oscuro o del sistema. El modo programado cambia automáticamente con los horarios de abajo.', System: 'Sistema', Light: 'Claro', Dark: 'Oscuro', Scheduled: 'Programado', 'Completion sound': 'Sonido al completar', 'Play a short sound when an item is completed': 'Reproducir un sonido breve al completar un elemento',
  'Accelerated day': 'Día acelerado', 'Enable accelerated test clock': 'Activar reloj de prueba acelerado', 'Seconds per simulated day': 'Segundos por día simulado', 'Defaults for new items': 'Valores predeterminados para elementos nuevos', 'Pinned values are copied only when this view creates a new item. They never change the filter or existing items.': 'Los valores fijados solo se copian al crear un elemento desde esta vista. No cambian el filtro ni los elementos existentes.', 'SQL-like filter': 'Filtro tipo SQL', Where: 'Donde', Join: 'Unión', 'First rule': 'Primera regla', Property: 'Propiedad', 'No value needed': 'No se necesita valor', 'The visual rules and SQL-like filter are synchronized.': 'Las reglas visuales y el filtro tipo SQL están sincronizados.', 'Enabled for this encrypted workspace copy.': 'Activado para esta copia cifrada del espacio.', 'Allow local notifications': 'Permitir notificaciones locales', 'Lock-screen content': 'Contenido de pantalla bloqueada', 'Generic — no task title leaves this device': 'Genérico: ningún título sale de este dispositivo', 'Show task title and urgency': 'Mostrar título y urgencia', 'Backup reminders': 'Recordatorios de copia de seguridad', 'Create encrypted backup now': 'Crear copia cifrada ahora', 'Last backup:': 'Última copia:',
});
Object.assign(extraTranslations.de, {
  'Interface sounds': 'Oberflächenklänge', 'Play calm sounds for buttons and controls': 'Ruhige Töne für Schaltflächen und Steuerelemente abspielen',
  Theme: 'Darstellung', 'Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.': 'Wähle ein helles, dunkles oder Systemdesign. Der geplante Modus wechselt zu den unten angegebenen Zeiten automatisch.', System: 'System', Light: 'Hell', Dark: 'Dunkel', Scheduled: 'Geplant', 'Completion sound': 'Abschlusston', 'Play a short sound when an item is completed': 'Beim Abschließen eines Elements einen kurzen Ton abspielen', 'Accelerated day': 'Beschleunigter Tag', 'Enable accelerated test clock': 'Beschleunigte Testuhr aktivieren', 'Seconds per simulated day': 'Sekunden pro simuliertem Tag', 'Defaults for new items': 'Standardwerte für neue Elemente', 'Pinned values are copied only when this view creates a new item. They never change the filter or existing items.': 'Fixierte Werte werden nur kopiert, wenn diese Ansicht ein neues Element erstellt. Sie ändern weder Filter noch bestehende Elemente.', 'SQL-like filter': 'SQL-ähnlicher Filter', Where: 'Wo', Join: 'Verknüpfung', 'First rule': 'Erste Regel', Property: 'Eigenschaft', 'No value needed': 'Kein Wert erforderlich', 'The visual rules and SQL-like filter are synchronized.': 'Die visuellen Regeln und der SQL-ähnliche Filter sind synchronisiert.', 'Enabled for this encrypted workspace copy.': 'Für diese verschlüsselte Arbeitsbereichskopie aktiviert.', 'Allow local notifications': 'Lokale Benachrichtigungen erlauben', 'Lock-screen content': 'Sperrbildschirminhalt', 'Generic — no task title leaves this device': 'Allgemein – kein Aufgabentitel verlässt dieses Gerät', 'Show task title and urgency': 'Aufgabentitel und Dringlichkeit anzeigen', 'Backup reminders': 'Backup-Erinnerungen', 'Create encrypted backup now': 'Verschlüsseltes Backup jetzt erstellen', 'Last backup:': 'Letztes Backup:',
});
Object.assign(extraTranslations.fr, {
  'Interface sounds': 'Sons de l’interface', 'Play calm sounds for buttons and controls': 'Jouer des sons doux pour les boutons et contrôles',
  Theme: 'Thème', 'Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.': 'Choisissez un thème clair, sombre ou système. Le mode programmé bascule automatiquement aux heures indiquées.', System: 'Système', Light: 'Clair', Dark: 'Sombre', Scheduled: 'Programmé', 'Completion sound': 'Son de fin', 'Play a short sound when an item is completed': 'Jouer un court son lorsqu’un élément est terminé', 'Accelerated day': 'Journée accélérée', 'Enable accelerated test clock': 'Activer l’horloge de test accélérée', 'Seconds per simulated day': 'Secondes par journée simulée', 'Defaults for new items': 'Valeurs par défaut des nouveaux éléments', 'Pinned values are copied only when this view creates a new item. They never change the filter or existing items.': 'Les valeurs épinglées ne sont copiées que lors de la création d’un élément depuis cette vue. Elles ne modifient ni le filtre ni les éléments existants.', 'SQL-like filter': 'Filtre de type SQL', Where: 'Où', Join: 'Jonction', 'First rule': 'Première règle', Property: 'Propriété', 'No value needed': 'Aucune valeur requise', 'The visual rules and SQL-like filter are synchronized.': 'Les règles visuelles et le filtre de type SQL sont synchronisés.', 'Enabled for this encrypted workspace copy.': 'Activé pour cette copie chiffrée de l’espace.', 'Allow local notifications': 'Autoriser les notifications locales', 'Lock-screen content': 'Contenu de l’écran verrouillé', 'Generic — no task title leaves this device': 'Générique — aucun titre ne quitte cet appareil', 'Show task title and urgency': 'Afficher le titre et l’urgence', 'Backup reminders': 'Rappels de sauvegarde', 'Create encrypted backup now': 'Créer une sauvegarde chiffrée maintenant', 'Last backup:': 'Dernière sauvegarde :',
});
Object.assign(extraTranslations.ko, {
  'Interface sounds': '인터페이스 소리', 'Play calm sounds for buttons and controls': '버튼과 컨트롤에 잔잔한 소리 재생',
  Theme: '테마', 'Choose a light, dark or system theme. Scheduled mode switches automatically using the times below.': '밝은 테마, 어두운 테마 또는 시스템 테마를 선택하세요. 예약 모드는 아래 시간에 자동으로 전환됩니다.', System: '시스템', Light: '밝게', Dark: '어둡게', Scheduled: '예약됨', 'Completion sound': '완료 소리', 'Play a short sound when an item is completed': '항목을 완료할 때 짧은 소리 재생', 'Accelerated day': '가속된 하루', 'Enable accelerated test clock': '가속 테스트 시계 사용', 'Seconds per simulated day': '시뮬레이션 하루당 초', 'Defaults for new items': '새 항목 기본값', 'Pinned values are copied only when this view creates a new item. They never change the filter or existing items.': '고정된 값은 이 보기에서 새 항목을 만들 때만 복사됩니다. 필터나 기존 항목은 변경하지 않습니다.', 'SQL-like filter': 'SQL형 필터', Where: '조건', Join: '연결', 'First rule': '첫 규칙', Property: '속성', 'No value needed': '값이 필요하지 않음', 'The visual rules and SQL-like filter are synchronized.': '시각 규칙과 SQL형 필터가 동기화됩니다.', 'Enabled for this encrypted workspace copy.': '이 암호화된 작업 공간 복사본에서 사용 설정됨.', 'Allow local notifications': '로컬 알림 허용', 'Lock-screen content': '잠금 화면 내용', 'Generic — no task title leaves this device': '일반 — 작업 제목이 이 기기를 벗어나지 않음', 'Show task title and urgency': '작업 제목과 긴급도 표시', 'Backup reminders': '백업 알림', 'Create encrypted backup now': '지금 암호화 백업 만들기', 'Last backup:': '마지막 백업:',
});

type LocalizedValue = { source: string; applied: string };
const localizedTexts = new WeakMap<Text, LocalizedValue>();
const localizedAttributes = new WeakMap<Element, Map<string, LocalizedValue>>();
const translatableAttributes = ['aria-label', 'placeholder', 'title'] as const;

function translatedRussianDynamic(value: string) {
  const rules: Array<[RegExp, string]> = [
    [/^Add item to (.+)$/, 'Добавить элемент в $1'], [/^Add Area to (.+)$/, 'Добавить область в $1'],
    [/^Edit (.+)$/, 'Редактировать $1'], [/^Complete (.+)$/, 'Завершить $1'], [/^Reopen (.+)$/, 'Открыть снова: $1'],
    [/^Expand (.+)$/, 'Развернуть $1'], [/^Collapse (.+)$/, 'Свернуть $1'], [/^Reorder (.+)$/, 'Изменить порядок: $1'],
    [/^Remove filter rule (\d+)$/, 'Удалить условие фильтра $1'], [/^Remove sort (\d+)$/, 'Удалить сортировку $1'],
    [/^Sort field (\d+)$/, 'Поле сортировки $1'], [/^Sort direction (\d+)$/, 'Направление сортировки $1'],
    [/^Empty values (\d+)$/, 'Пустые значения $1'], [/^Remove reminder (\d+)$/, 'Удалить напоминание $1'],
    [/^Reminder (\d+)$/, 'Напоминание $1'], [/^Remove script (.+)$/, 'Удалить скрипт $1'],
    [/^(\d+) matching items$/, 'Подходящих элементов: $1'], [/^(\d+) recorded entries$/, 'Записей: $1'],
    [/^Compatibility notes \((\d+)\)$/, 'Примечания о совместимости ($1)'], [/^Troubleshooting log \((\d+)\)$/, 'Журнал диагностики ($1)'],
    [/^Unscheduled \((\d+)\)$/, 'Без даты ($1)'], [/^Readable items \((\d+)\)$/, 'Читаемые элементы ($1)'],
    [/^Last backup: (.+)$/, 'Последняя копия: $1'], [/^Open (.+) in Calendar$/, 'Открыть $1 в календаре'],
    [/^New Project in (.+)$/, 'Новый проект в $1'], [/^Default value for (.+)$/, 'Значение по умолчанию для $1'],
    [/^New key for (.+)$/, 'Новый ключ для $1'], [/^Item will be kept in this Project: (.+)$/, 'Элемент останется в проекте: $1'],
  ];
  for (const [pattern, replacement] of rules) if (pattern.test(value)) return value.replace(pattern, replacement);
  return value;
}

export function translateInterfaceText(value: string, language: WorkspaceLanguage) {
  if (language === 'en') return value;
  const exact = onboarding[language][value] ?? common[language][value] ?? extraTranslations[language][value];
  return exact ?? (language === 'ru' ? translatedRussianDynamic(value) : value);
}

function shouldSkip(node: Text) {
  const parent = node.parentElement;
  return !parent || Boolean(parent.closest('code, pre, textarea, input, output, .syntax-editor, .rendered-markdown'));
}

export function localizeDom(root: ParentNode, language: WorkspaceLanguage) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const node of texts) {
    if (shouldSkip(node)) continue;
    const current = node.nodeValue ?? '';
    const previous = localizedTexts.get(node);
    // React commonly reuses a Text node and changes its value in place. Treat
    // anything other than our last translated output as fresh application
    // content, otherwise a MutationObserver would restore the first value and
    // freeze counters/status labels on screen.
    const source = !previous || current !== previous.applied ? current : previous.source;
    const leading = source.match(/^\s*/)?.[0] ?? '';
    const trailing = source.match(/\s*$/)?.[0] ?? '';
    const core = source.slice(leading.length, source.length - trailing.length);
    const applied = `${leading}${translateInterfaceText(core, language)}${trailing}`;
    localizedTexts.set(node, { source, applied });
    if (current !== applied) node.nodeValue = applied;
  }
  for (const element of Array.from((root as Document | Element).querySelectorAll?.('[aria-label], [placeholder], [title]') ?? [])) {
    const seen = localizedAttributes.get(element) ?? new Map<string, LocalizedValue>();
    localizedAttributes.set(element, seen);
    for (const attribute of translatableAttributes) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const previous = seen.get(attribute);
      const source = !previous || current !== previous.applied ? current : previous.source;
      const applied = translateInterfaceText(source, language);
      seen.set(attribute, { source, applied });
      if (current !== applied) element.setAttribute(attribute, applied);
    }
  }
}

/** Keeps static React labels translated without ever modifying item content or DSL/JSON editors. */
export function installDomLocalization(language: WorkspaceLanguage) {
  document.documentElement.lang = language;
  localizeDom(document.body, language);
  const observer = new MutationObserver(() => localizeDom(document.body, language));
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
