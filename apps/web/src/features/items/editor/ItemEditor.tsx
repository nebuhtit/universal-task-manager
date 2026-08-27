import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  createId, evaluateFormulas, evaluateItemScripts, migrateItem, orderedListNames, orderedOrganizationNames, organizationDefinitionFor, parsePortablePackage,
  type Schedule, type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import { CodeEditor } from '../../../components/ui/CodeEditor';
import { CloseIcon } from '../../../components/ui/icons';
import { Button, Checkbox, Field, Input, Select } from '../../../components/ui/primitives';
import { SectionGuide } from '../../../components/ui/SectionGuide';
import { formatViewDate } from '../../../utils/dates';
import { calendarDuration, calendarDurationMs, parseFriendlyDuration, toIsoDuration, type FriendlyDurationUnit } from '../../../utils/durations';
import { inferredPreset, priorityNames, stateNames } from '../fieldDisplay';
import { FieldIconLabel } from '../FieldIcon';
import { normalizeItemForSave, withoutTemplateMarker } from './itemEditorModel';
import { ItemSection } from './ItemSection';
import { DateTimeField } from './fields/DateTimeField';
import { DatesSection } from './sections/DatesSection';
import { RemindersSection } from './sections/RemindersSection';
import { RecurrenceSection } from './sections/RecurrenceSection';
import { ScriptsSection } from './sections/ScriptsSection';

type PortableFormat = 'json' | 'csv' | 'xlsx' | 'ics';
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const stopwatchDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60); const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
};

export function ItemEditor({ initial, workspace, now, isNew = false, onSave, onDelete, onCreateSubtask, onToggleSubtask, onReadPortableFile, onExportItem, onClose }: {
  initial: UniversalItem; workspace: WorkspaceDocument; now: Date; isNew?: boolean; onSave: (item: UniversalItem) => void; onDelete: (item: UniversalItem) => void; onCreateSubtask: (title: string, parentId: string) => UniversalItem; onToggleSubtask: (id: string) => void; onReadPortableFile: (file: File) => Promise<string>; onExportItem: (item: UniversalItem, format: PortableFormat, metadata?: boolean) => void; onClose: () => void;
}) {
  const [item, setItem] = useState(() => clean(initial));
  const [tags, setTags] = useState(item.tags.join(', '));
  const [contexts, setContexts] = useState(item.contexts.join(', '));
  const [recurring, setRecurring] = useState(item.role === 'series_template');
  const [repeatIntervalDraft, setRepeatIntervalDraft] = useState('1');
  const [error, setError] = useState('');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonDirty, setJsonDirty] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isTemplate, setIsTemplate] = useState(Boolean(item.extensions?.['utm:template']));
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  // The global quick-capture field deliberately offers one fast second Enter.
  // As soon as the person explores another editor control, saving becomes an
  // explicit action so Enter can safely be used for tags and other fields.
  const quickTitleSaveAllowed = useRef(isNew);
  const retainedQuickCaptureFocus = useRef(typeof document !== 'undefined' && Boolean(document.activeElement?.closest('.quick-capture'))).current;
  const templates = Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.extensions?.['utm:template'] === true && candidate.id !== item.id);
  const focusTitleOnOpen = typeof window !== 'undefined' && window.matchMedia('(min-width: 621px)').matches;
  // Parent links are stored on the parent item (parent -> child). Derive the
  // reverse side so a child always shows its parent in the editor.
  const parentItems = Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.id !== item.id && candidate.relations.some((relation) => relation.type === 'parent' && relation.targetId === item.id));
  const applyTemplate = (template: UniversalItem) => {
    const identity = { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, revision: item.revision, createdWithAppId: item.createdWithAppId, createdWithAppName: item.createdWithAppName, createdWithVersion: item.createdWithVersion };
    const next = clean({ ...template, ...identity, state: 'open' as const, role: 'standalone' as const, extensions: { ...template.extensions } });
    const cleanNext = withoutTemplateMarker(next);
    setItem(cleanNext); setTags(cleanNext.tags.join(', ')); setContexts(cleanNext.contexts.join(', ')); setRecurring(false); setIsTemplate(false); setJsonDraft(JSON.stringify(cleanNext, null, 2)); setJsonDirty(false);
  };
  const importJsonRef = useRef<HTMLInputElement>(null);
  const definitions = Object.values(workspace.customFields);
  const formulas = evaluateFormulas(item, definitions);
  const scriptResults = evaluateItemScripts(item, (id) => workspace.items[id], now);
  const patchItem = (patch: { [Key in keyof UniversalItem]?: UniversalItem[Key] | undefined }) => setItem((current) => {
    const next = { ...current } as Record<string, unknown>;
    Object.entries(patch).forEach(([key, value]) => { if (value === undefined) delete next[key]; else next[key] = value; });
    return next as unknown as UniversalItem;
  });
  const patchSchedule = (patch: { [Key in keyof Schedule]?: Schedule[Key] | undefined }) => setItem((current) => {
    const schedule = { timezone: current.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, ...current.schedule } as Record<string, unknown>;
    Object.entries(patch).forEach(([key, value]) => { if (value === undefined) delete schedule[key]; else schedule[key] = value; });
    return { ...current, schedule: schedule as unknown as Schedule };
  });
  const patchRecurrence = (patch: Partial<NonNullable<UniversalItem['recurrence']>>) => setItem((current) => ({ ...current, recurrence: {
    rrule: current.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1', rdates: current.recurrence?.rdates ?? [], exdates: current.recurrence?.exdates ?? [],
    timezone: current.recurrence?.timezone ?? current.schedule?.timezone ?? 'UTC', activationOffset: current.recurrence?.activationOffset ?? 'P7D',
    closeAt: current.recurrence?.closeAt ?? 'next_activation', anchor: current.recurrence?.anchor ?? 'schedule', autoRenew: current.recurrence?.autoRenew ?? true, ...patch,
  } }));
  const rruleMap = () => new Map((item.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1').split(';').filter(Boolean).map((part) => { const [key, ...rest] = part.split('='); return [key!.trim().toUpperCase(), rest.join('=').trim()]; }));
  const updateRrule = (changes: Record<string, string | undefined>) => {
    const parts = rruleMap();
    Object.entries(changes).forEach(([key, value]) => { if (value) parts.set(key, value); else parts.delete(key); });
    patchRecurrence({ rrule: [...parts].map(([key, value]) => `${key}=${value}`).join(';') });
  };
  // Imported RRULEs are not always consistent about casing. Normalize the
  // frequency once so the selector and its human-readable unit cannot drift
  // apart (e.g. MONTHLY with a stale "week" suffix).
  const repeatFrequency = (rruleMap().get('FREQ') ?? 'WEEKLY').toUpperCase();
  const repeatInterval = Number(rruleMap().get('INTERVAL') ?? 1);
  const repeatUnit = ({ MINUTELY: 'minute', HOURLY: 'hour', DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as Record<string, string>)[repeatFrequency] ?? 'week';
  const repeatDays = (rruleMap().get('BYDAY') ?? '').split(',').filter(Boolean);
  useEffect(() => {
    setRepeatIntervalDraft(String(Number.isFinite(repeatInterval) && repeatInterval > 0 ? repeatInterval : 1));
    // This effect runs when a different item or recurrence rule is loaded.
    // While typing, the draft itself is intentionally left untouched until
    // blur so an empty number field does not immediately turn back into “1”.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.recurrence?.rrule]);
  const activation = parseFriendlyDuration(item.recurrence?.activationOffset);
  const activeRange = recurring && Boolean(item.recurrence?.autoRenew) && item.recurrence?.closeAt === 'due' && activation.amount === 0;
  const scheduledDuration = calendarDuration(item.schedule?.startAt, item.schedule?.endAt);
  const patchScheduledDuration = (amount: number, unit: FriendlyDurationUnit) => {
    const start = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
    if (!Number.isFinite(start)) return;
    patchSchedule({ endAt: new Date(start + calendarDurationMs(Math.max(1, amount), unit)).toISOString() });
  };
  const applyDurationPreset = (preset: string) => {
    if (preset === '1h') patchScheduledDuration(1, 'hours');
    else if (preset === '2h' || preset === '3h' || preset === '5h') patchScheduledDuration(Number(preset.slice(0, -1)), 'hours');
    else if (preset === 'until-sleep') {
      const start = item.schedule?.startAt ? new Date(item.schedule.startAt) : null;
      const sleep = workspace.calendarPreferences?.sleepSchedule?.sleep ?? '22:00';
      if (start) {
        const [hours, minutes] = sleep.split(':').map(Number);
        const end = new Date(start);
        end.setHours(hours || 22, minutes || 0, 0, 0);
        if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
        patchSchedule({ endAt: end.toISOString(), allDay: false });
      }
    } else if (preset === 'all-day') {
      const start = item.schedule?.startAt ? new Date(item.schedule.startAt) : null;
      if (start) patchSchedule({ allDay: true, endAt: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() });
    }
    else if (preset) patchScheduledDuration(Number(preset), 'minutes');
  };
  const knownTags = [...new Set(Object.values(workspace.items).flatMap((entry) => entry.tags))].sort((left, right) => left.localeCompare(right));
  const collectedTags = [...new Set([...knownTags, ...commaList(tags)])];
  const toggleTag = (tag: string) => setTags((current) => {
    const values = commaList(current);
    return (values.includes(tag) ? values.filter((value) => value !== tag) : [...values, tag]).join(', ');
  });
  useEffect(() => { if (!jsonDirty) setJsonDraft(JSON.stringify(item, null, 2)); }, [item, jsonDirty]);

  const readImportedItem = (source: string): UniversalItem => {
    const parsed = JSON.parse(source) as unknown;
    if (parsed && typeof parsed === 'object' && (parsed as { format?: string }).format === 'utm-portable') {
      const portable = parsePortablePackage(source).package;
      if (!portable.items[0]) throw new Error('The package contains no items.');
      return portable.items[0];
    }
    return migrateItem(parsed, 'editor:json').value;
  };
  const applyJson = () => {
    setError('');
    try {
      const parsed = readImportedItem(jsonDraft);
      const existing = workspace.items[item.id];
      const next = clean(parsed);
      if (existing) {
        next.id = existing.id; next.schemaVersion = existing.schemaVersion;
        const mutable = next as UniversalItem & { createdWithAppId: string; createdWithAppName: string; createdWithVersion: string };
        mutable.createdWithAppId = existing.createdWithAppId; mutable.createdWithAppName = existing.createdWithAppName;
        mutable.createdWithVersion = existing.createdWithVersion; next.createdAt = existing.createdAt;
        next.updatedAt = existing.updatedAt; next.revision = existing.revision;
        if (existing.deletedAt) next.deletedAt = existing.deletedAt; else delete next.deletedAt;
        if (existing.role === 'occurrence') { next.role = existing.role; next.occurrence = clean(existing.occurrence!); }
      }
      setItem(next); setTags(next.tags.join(', ')); setContexts(next.contexts.join(', ')); setRecurring(next.role === 'series_template');
      setJsonDirty(false); setJsonDraft(JSON.stringify(next, null, 2));
    } catch (reason) { setError(`JSON was not applied: ${reason instanceof Error ? reason.message : String(reason)}`); }
  };
  const importAsNew = async (file: File) => {
    try {
      const converted = { source: await onReadPortableFile(file) };
      const imported = clean(readImportedItem(converted.source)); const timestamp = now.toISOString();
      imported.id = createId(); imported.createdAt = timestamp; imported.updatedAt = timestamp; imported.revision = 1; delete imported.deletedAt;
      if (imported.role === 'occurrence') { imported.role = 'standalone'; delete imported.occurrence; }
      setItem(imported); setTags(imported.tags.join(', ')); setContexts(imported.contexts.join(', ')); setRecurring(imported.role === 'series_template'); setJsonDraft(JSON.stringify(imported, null, 2)); setJsonDirty(false); setError('');
    } catch (reason) { setError(`Could not import item: ${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { if (importJsonRef.current) importJsonRef.current.value = ''; }
  };
  const exportItemJson = () => onExportItem(item, 'json');
  const exportItem = (format: PortableFormat, metadata = false) => onExportItem(item, format, metadata);

  const save = () => {
    setError('');
    try {
      onSave(normalizeItemForSave({ item, workspace, tags, contexts, isTemplate, recurring, activeRange, repeatFrequency, repeatIntervalDraft, repeatDays, now }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => {
    const saveFromRetainedMobileKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const target = event.target;
      if (!quickTitleSaveAllowed.current || !item.title.trim() || !(target instanceof HTMLInputElement) || !target.closest('.quick-capture')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      quickTitleSaveAllowed.current = false;
      save();
    };
    window.addEventListener('keydown', saveFromRetainedMobileKeyboard, true);
    return () => window.removeEventListener('keydown', saveFromRetainedMobileKeyboard, true);
  });

  useLayoutEffect(() => {
    if (!retainedQuickCaptureFocus) return;
    titleInputRef.current?.focus({ preventScroll: true });
    editorScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    window.scrollTo(0, 0);
  }, [retainedQuickCaptureFocus]);

  // A compact signal for existing items: it shows which optional sections contain data.
  // New items stay intentionally quiet until the user opens a section.
  const sectionMark = (filled: boolean) => !isNew && filled ? <span className="section-dot" aria-label="Contains data">•</span> : null;
  const dateField = (label: string, value: string | undefined, onChange: (value: string | undefined) => void, help?: string, onFocus?: () => void, minValue?: string) => <DateTimeField label={label} value={value} language={workspace.calendarPreferences.language} onChange={onChange} help={help} onFocus={onFocus} minValue={minValue} />;
  const activeTimerSeconds = item.habit?.activeTimerStartedAt ? Math.max(0, (now.getTime() - Date.parse(item.habit.activeTimerStartedAt)) / 1000) : 0;
  const startHabitTimer = () => {
    if (!item.habit || item.habit.activeTimerStartedAt) return;
    patchItem({ habit: { ...item.habit, activeTimerStartedAt: now.toISOString() } });
  };
  const stopHabitTimer = () => {
    const habit = item.habit; const startedAt = habit?.activeTimerStartedAt;
    if (!habit || !startedAt) return;
    const endedAt = now.toISOString();
    const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
    const { activeTimerStartedAt: _active, ...rest } = habit;
    patchItem({ habit: { ...rest, timerSessions: [...(habit.timerSessions ?? []), { id: createId(), startedAt, endedAt, durationSeconds }] } });
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="drawer" role="dialog" aria-modal="true" aria-label="Item editor" onFocusCapture={(event) => {
      if (event.target !== titleInputRef.current) quickTitleSaveAllowed.current = false;
    }} onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return;
      if (!quickTitleSaveAllowed.current || event.target !== titleInputRef.current || !item.title.trim()) return;
      event.preventDefault();
      quickTitleSaveAllowed.current = false;
      save();
    }}>
      <header className="drawer-head"><div><p className="eyebrow">UNIVERSAL ITEM</p><h2>{workspace.items[item.id] ? 'Edit item' : 'New item'}</h2></div><button className="icon-button" aria-label="Close item editor" onClick={onClose}><CloseIcon /></button></header>
      <div className="editor-scroll" ref={editorScrollRef}>
        <label className="item-title-field"><FieldIconLabel path="title" label="Title" /><input ref={titleInputRef} autoFocus={focusTitleOnOpen} value={item.title} onChange={(event) => patchItem({ title: event.target.value })} placeholder="What needs to happen?" /></label>
        {isNew && templates.length > 0 && <details className="template-picker"><summary><FieldIconLabel path="isTemplate" label="Choose a saved template" /> <span>Optional</span></summary><div className="details-body"><p className="schedule-explainer">Pick a template to prefill this new item. Nothing changes until you select one, and you can edit every field before saving.</p>{templates.map((template) => <button type="button" className="template-option" key={template.id} onClick={() => applyTemplate(template)}>{template.title || 'Untitled template'}</button>)}</div></details>}
        <DatesSection item={item} workspace={workspace} sectionMark={sectionMark} patchSchedule={patchSchedule} scheduledDuration={scheduledDuration} patchScheduledDuration={patchScheduledDuration} applyDurationPreset={applyDurationPreset}>
          <RemindersSection item={item} now={now} sectionMark={sectionMark} patchItem={patchItem} />
          <RecurrenceSection item={item} workspace={workspace} sectionMark={sectionMark} recurring={recurring} setRecurring={setRecurring} patchRecurrence={patchRecurrence} repeatFrequency={repeatFrequency} repeatInterval={repeatInterval} repeatIntervalDraft={repeatIntervalDraft} setRepeatIntervalDraft={setRepeatIntervalDraft} repeatUnit={repeatUnit} repeatDays={repeatDays} updateRrule={updateRrule} activeRange={activeRange} activation={activation} />
          <details><summary><FieldIconLabel path="habit.completedDates" label="Progress & habit" /> {sectionMark(Boolean(item.progress || item.habit))}</summary><div className="details-body">
            <SectionGuide title="Progress versus habit"><p>Progress describes the current item. A habit stays one item and records completed calendar dates instead of creating a duplicate item for every day.</p><p>Set the repeat interval and weekdays in <strong>Recurrence &amp; auto-renew</strong>.</p></SectionGuide>
            <div className="form-grid three"><label><FieldIconLabel path="progress.mode" label="Mode" /><select value={item.progress?.mode ?? 'counter'} onChange={(event) => patchItem({ progress: { mode: event.target.value as 'counter', current: item.progress?.current ?? 0, target: item.progress?.target ?? 1 } })}><option>boolean</option><option>percent</option><option>counter</option></select></label>
            <label><FieldIconLabel path="progress.current" label="Current" /><input type="number" value={item.progress?.current ?? 0} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: Number(event.target.value), target: item.progress?.target ?? 1 } })} /></label>
            <label><FieldIconLabel path="progress.target" label="Target" /><input type="number" value={item.progress?.target ?? 1} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: item.progress?.current ?? 0, target: Number(event.target.value) } })} /></label></div>
            <label className="check"><input type="checkbox" checked={Boolean(item.habit)} onChange={(event) => patchItem({ habit: event.target.checked ? { ...item.habit, target: item.progress?.target ?? item.habit?.target ?? 1, unit: item.habit?.unit ?? 'times', streakMode: item.habit?.streakMode ?? 'manual_only', completedDates: item.habit?.completedDates ?? [] } : undefined })} /> <FieldIconLabel path="isHabit" label="Track as a habit" /></label>
            {item.habit && <><div className="habit-stopwatch"><div><strong>{item.habit.activeTimerStartedAt ? stopwatchDuration(activeTimerSeconds) : '00:00:00'}</strong><small>{item.habit.activeTimerStartedAt ? `Started ${formatViewDate(item.habit.activeTimerStartedAt, true, workspace.calendarPreferences.language)}` : 'Simple habit stopwatch'}</small></div>{item.habit.activeTimerStartedAt ? <Button size="compact" onClick={stopHabitTimer}>Stop</Button> : <Button size="compact" onClick={startHabitTimer}>Start</Button>}</div><div className="habit-history"><strong>{item.habit.completedDates?.length ?? 0} completions</strong><small>{item.habit.completedDates?.length ? `Completed on ${[...(item.habit.completedDates ?? [])].sort().map((date) => formatViewDate(`${date}T00:00:00`, false, workspace.calendarPreferences.language)).join(', ')}` : 'No completion dates yet.'}</small>{(item.habit.timerSessions?.length ?? 0) > 0 && <ol className="habit-timer-history">{[...(item.habit.timerSessions ?? [])].reverse().map((session) => <li key={session.id}><span>{formatViewDate(session.startedAt, true, workspace.calendarPreferences.language)} — {formatViewDate(session.endedAt, true, workspace.calendarPreferences.language)}</span><strong>{stopwatchDuration(session.durationSeconds)}</strong></li>)}</ol>}</div></>}
          </div></details>
        </DatesSection>

        <ItemSection sectionKey="organization" title="Organization" iconPath="list" filledMark={sectionMark(Boolean(item.area || item.project || item.list || item.priority || commaList(tags).length))}>
          <div className="form-grid two organization-fields">
            <Field label="Area" optional><Select aria-label="Choose existing Area" value={item.area ?? ''} onChange={(event) => patchItem({ area: event.target.value || undefined, project: undefined })}><option value="">No Area</option>{orderedOrganizationNames(workspace, 'area').map((name) => <option value={name} key={name}>{name}</option>)}</Select><Input aria-label="Create Area" value={item.area ?? ''} onChange={(event) => patchItem({ area: event.target.value.trim() || undefined })} placeholder="Or create a new Area" /></Field>
            <Field label="Project" optional><Select aria-label="Choose existing Project" value={item.project ?? ''} onChange={(event) => { const project = event.target.value; const definition = organizationDefinitionFor(workspace, 'project', project); patchItem({ project: project || undefined, ...(definition && 'area' in definition && definition.area ? { area: definition.area } : {}) }); }}><option value="">No Project</option>{orderedOrganizationNames(workspace, 'project', item.area).map((name) => <option value={name} key={name}>{name}</option>)}</Select><Input aria-label="Create Project" value={item.project ?? ''} onChange={(event) => patchItem({ project: event.target.value.trim() || undefined })} placeholder="Or create a new Project" /></Field>
            <Field label="Task list" optional><Select aria-label="Choose existing Task list" value={item.list ?? ''} onChange={(event) => patchItem({ list: event.target.value || undefined })}><option value="">No list</option>{orderedListNames(workspace).map((name) => <option value={name} key={name}>{name}</option>)}</Select><Input aria-label="Create Task list" value={item.list ?? ''} onChange={(event) => patchItem({ list: event.target.value.trim() || undefined })} placeholder="Or create a new list" /></Field>
            <Field label="Priority"><Select aria-label="Priority" value={item.priority ?? 0} onChange={(event) => patchItem({ priority: Number(event.target.value) as NonNullable<UniversalItem['priority']> })}>{([0, 1, 2, 3, 4] as NonNullable<UniversalItem['priority']>[]).map((priority) => <option key={priority} value={priority}>{priority ? `${priority} — ${priorityNames[priority]}` : 'None'}</option>)}</Select></Field>
          </div>
          <Field label="Tags"><Input aria-label="Tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Add tags separated by commas" /></Field>{collectedTags.length > 0 && <div className="tag-collection" aria-label="Available tags">{collectedTags.map((tag) => <Button size="compact" variant="ghost" className={commaList(tags).includes(tag) ? 'active' : ''} aria-pressed={commaList(tags).includes(tag)} key={tag} onClick={() => toggleTag(tag)}>#{tag}</Button>)}</div>}
        </ItemSection>

        <details className="description-section"><summary><FieldIconLabel path="bodyMarkdown" label="Description" /> {sectionMark(Boolean(item.bodyMarkdown.trim()))}</summary><div className="details-body">
          <label><span className="hint">Markdown</span><textarea rows={5} value={item.bodyMarkdown} onChange={(event) => patchItem({ bodyMarkdown: event.target.value })} placeholder="Context, links, checklists…" /></label>
          {item.bodyMarkdown && <details className="markdown-details"><summary>Markdown preview</summary><div className="markdown preview"><ReactMarkdown>{item.bodyMarkdown}</ReactMarkdown></div></details>}
        </div></details>

        <ItemSection sectionKey="more" title="More" iconPath="custom">
        <ItemSection sectionKey="template" title="Template" iconPath="isTemplate" filledMark={sectionMark(isTemplate)}><Checkbox checked={isTemplate} onChange={(event) => setIsTemplate(event.target.checked)} label="Save this item as a template" /><p className="schedule-explainer">Templates are kept in the same workspace but do not appear in ordinary lists. They can be selected only while creating a new item.</p></ItemSection>

        <details><summary><FieldIconLabel path="subtasks" label="Subtasks" /> {sectionMark(item.relations.some((relation) => relation.type === 'parent'))}</summary><div className="details-body">
          <p className="schedule-explainer">Add existing items as steps of this item. Subtasks remain independent universal items and can be completed or edited on their own.</p>
          {item.relations.filter((relation) => relation.type === 'parent').map((relation) => { const subtask = workspace.items[relation.targetId]; const completed = subtask?.state === 'done'; return <div className={`subtask-row${completed ? ' completed' : ''}`} key={relation.id}><button type="button" className={`subtask-check${completed ? ' checked' : ''}`} aria-label={`${completed ? 'Reopen' : 'Complete'} subtask ${subtask?.title ?? relation.targetId}`} onClick={() => onToggleSubtask(relation.targetId)}>{completed ? '✓' : ''}</button><span>{subtask?.title ?? relation.targetId}</span><button type="button" aria-label="Remove subtask" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>; })}
          <div className="inline-row"><input aria-label="New subtask title" value={newSubtaskTitle} onChange={(event) => setNewSubtaskTitle(event.target.value)} placeholder="New subtask title" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title, item.id); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); } }} /><button className="secondary" onClick={() => { const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title, item.id); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); }}>Add subtask</button></div>
        </div></details>

        <ItemSection sectionKey="status" title="Status" iconPath="state" filledMark={sectionMark(item.state !== 'open')}><Field label="Item status" hint="Status normally changes through completion, cancellation, auto-renew or archiving."><Select aria-label="Item status" value={item.state} onChange={(event) => { const state = event.target.value as UniversalItem['state']; patchItem({ state, closure: state === 'open' ? undefined : { at: item.closure?.at ?? now.toISOString(), actor: item.closure?.actor ?? 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' } }); }}>{['open', 'done', 'cancelled', 'auto_closed', 'archived'].map((state) => <option key={state} value={state}>{stateNames[state as UniversalItem['state']]}</option>)}</Select></Field>{(item.state === 'done' || item.state === 'cancelled') && <label>Actually {item.state === 'done' ? 'completed' : 'cancelled'} at {dateField(`Actually ${item.state === 'done' ? 'completed' : 'cancelled'} at`, item.closure?.at, (value) => { if (value) patchItem({ closure: { at: value, actor: item.closure?.actor ?? 'user', reason: item.state === 'cancelled' ? 'cancelled' : 'manual' } }); else patchItem({ closure: undefined }); }, 'Defaults to now. Change this when you are recording the item after it happened. For a completion-anchored series, the next cycle uses this time when this cycle is first closed.')}</label>}</ItemSection>

        <details><summary><FieldIconLabel path="relations" label="Relations & links" /> {sectionMark(item.relations.length > 0 || item.attachments.length > 0 || parentItems.length > 0)}</summary><div className="details-body">
          <SectionGuide title="Linking items"><p>Relations connect two items without making either one a subtask. Links are URL references only; files are not stored in this workspace.</p></SectionGuide>
          {parentItems.map((parent) => <div className="chip" key={`parent-${parent.id}`}><span>Parent: {parent.title}</span><small className="hint">This item is a subtask</small></div>)}
          {item.relations.map((relation) => <div className="chip" key={relation.id}>{relation.type}: {workspace.items[relation.targetId]?.title ?? relation.targetId}<button aria-label="Remove relation" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>)}
          <div className="inline-row"><select id="relation-target" defaultValue=""><option value="">Choose related item…</option>{Object.values(workspace.items).filter((candidate) => candidate.id !== item.id && !candidate.deletedAt).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}</select><button className="secondary" onClick={() => { const select = document.getElementById('relation-target') as HTMLSelectElement; if (select.value) patchItem({ relations: [...item.relations, { id: createId(), targetId: select.value, type: 'related' }] }); }}>Link</button></div>
          {item.attachments.map((attachment) => <div className="chip" key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.title ?? attachment.url}</a><button aria-label="Remove link" onClick={() => patchItem({ attachments: item.attachments.filter((entry) => entry.id !== attachment.id) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => { const url = window.prompt('Link URL'); if (url) patchItem({ attachments: [...item.attachments, { id: createId(), url }] }); }}>+ Add link</button>
        </div></details>

        <ScriptsSection item={item} patchItem={patchItem} scriptResults={scriptResults} />
        {definitions.length > 0 && <details><summary><FieldIconLabel path="custom" label="Custom fields" /> {sectionMark(Object.keys(item.custom).length > 0)}</summary><div className="details-body">{definitions.map((field) => <label key={field.id}><FieldIconLabel path={`custom.${field.key}`} label={field.label} />{field.kind === 'formula' ? <output className="formula-output">{String(formulas.values[field.key] ?? formulas.errors[field.key] ?? '—')}</output> : <input value={String(item.custom[field.key] ?? '')} onChange={(event) => patchItem({ custom: { ...item.custom, [field.key]: field.kind === 'number' ? Number(event.target.value) : field.kind === 'boolean' ? event.target.value === 'true' : event.target.value } })} />}</label>)}</div></details>}
        <details><summary><FieldIconLabel path="system.json" label="Item JSON" /> {sectionMark(jsonDirty)}</summary><div className="details-body json-editor"><p className="hint">Edit the same item draft as the form. Protected identity, provenance, timestamps and occurrence fields are preserved when updating an existing item.</p><SectionGuide title="JSON safety"><p>Apply JSON updates the form first; only Save item writes it to the workspace. Import as new item always creates a separate copy. Exported data is readable, so do not share it accidentally.</p></SectionGuide><CodeEditor language="json" ariaLabel="Item JSON" rows={18} value={jsonDraft} onChange={(value) => { setJsonDraft(value); setJsonDirty(true); }} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => { setJsonDraft(JSON.stringify(item, null, 2)); setJsonDirty(false); }}>Refresh from form</button><button className="secondary compact-action" onClick={applyJson}>Apply JSON to form</button><details className="inline-menu"><summary>Export…</summary><div><button onClick={exportItemJson}>JSON</button><button onClick={() => exportItem('csv')}>CSV</button><button onClick={() => exportItem('xlsx')}>Excel</button><button onClick={() => exportItem('ics')}>iCalendar</button><button onClick={() => exportItem('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary compact-action" onClick={() => importJsonRef.current?.click()}>Import as new item</button><input ref={importJsonRef} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void importAsNew(event.target.files[0])} /></div></div></details>
        {Boolean(item.cycleHistory?.length) && <details><summary><FieldIconLabel path="cycleHistory" label="Cycle history" /> <span className="summary-count">{item.cycleHistory!.length}</span></summary><div className="details-body cycle-history"><p className="field-hint">Finished auto-renew cycles stay inside this item. Its current Dates &amp; time always describe the active or most recent cycle.</p>{[...item.cycleHistory!].reverse().map((cycle) => <article key={cycle.recurrenceId}><div><strong>{cycle.state === 'auto_closed' ? 'Auto closed' : cycle.state === 'done' ? 'Completed' : 'Cancelled'}</strong><time dateTime={cycle.closedAt}>{formatViewDate(cycle.closedAt, true, workspace.calendarPreferences.language)}</time></div><small>{cycle.startAt ? `Opened ${formatViewDate(cycle.startAt, true, workspace.calendarPreferences.language)}` : `Cycle ${formatViewDate(cycle.recurrenceId, true, workspace.calendarPreferences.language)}`}{cycle.dueAt ? ` · Due ${formatViewDate(cycle.dueAt, true, workspace.calendarPreferences.language)}` : ''}</small></article>)}</div></details>}
        <details><summary><FieldIconLabel path="system" label="System metadata" /></summary><div className="details-body metadata-grid"><div><span>Created at</span><output><time dateTime={item.createdAt}>{formatViewDate(item.createdAt, true, workspace.calendarPreferences.language)}</time></output></div><div><span>Last modified</span><output><time dateTime={item.updatedAt}>{formatViewDate(item.updatedAt, true, workspace.calendarPreferences.language)}</time></output></div><div><span>Created by application</span><output>{item.createdWithAppName} v{item.createdWithVersion}</output></div><div><span>Application ID</span><output className="mono">{item.createdWithAppId}</output></div><div><span>Item schema</span><output>{item.schemaVersion}</output></div><div><span>Item ID</span><output>{item.id}</output></div></div></details>
        </ItemSection>
      </div>
      {error && <p className="editor-error error" role="alert">{error}</p>}
      <footer className="drawer-actions">{workspace.items[item.id] && <button className="danger" onClick={() => onDelete(item)}>Delete</button>}<span /><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save item</button></footer>
    </section>
  </div>;
}
