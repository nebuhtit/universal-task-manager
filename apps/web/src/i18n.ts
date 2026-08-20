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
  'Add new task': 'Добавить новую задачу', 'Add task': 'Добавить задачу', 'New item': 'Новый элемент', 'New view': 'Новый вид',
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
  'Already have an encrypted workspace?': 'Уже есть зашифрованное пространство?', 'Import .utm': 'Импорт .utm',
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

const originals = new WeakMap<Text, string>();
const attributeOriginals = new WeakMap<Element, Map<string, string>>();
const translatableAttributes = ['aria-label', 'placeholder', 'title'] as const;

function translated(value: string, language: WorkspaceLanguage) {
  return language === 'en' ? value : onboarding[language][value] ?? common[language][value] ?? value;
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
    const original = originals.get(node) ?? node.nodeValue ?? '';
    originals.set(node, original);
    const leading = original.match(/^\s*/)?.[0] ?? '';
    const trailing = original.match(/\s*$/)?.[0] ?? '';
    const core = original.slice(leading.length, original.length - trailing.length);
    node.nodeValue = `${leading}${translated(core, language)}${trailing}`;
  }
  for (const element of Array.from((root as Document | Element).querySelectorAll?.('[aria-label], [placeholder], [title]') ?? [])) {
    const seen = attributeOriginals.get(element) ?? new Map<string, string>();
    attributeOriginals.set(element, seen);
    for (const attribute of translatableAttributes) {
      const current = element.getAttribute(attribute);
      if (!current) continue;
      const original = seen.get(attribute) ?? current;
      seen.set(attribute, original);
      element.setAttribute(attribute, translated(original, language));
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
