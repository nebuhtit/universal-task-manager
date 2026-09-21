import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { addTimerActualTime, canManuallyComplete, googleCalendarEventToItem, googleCalendarProjection, initializeItemHistory, recordCompletionTransition } from '@utm/core';
import { googleActionItem } from './itemEditorSource';
import type { GoogleCalendarEvent } from '@utm/core';
import { ItemHistoryJournals } from './sections/ItemHistoryJournals';
import { EventProgramSection } from './sections/EventProgramSection';
import { programOverflow, trimEventProgram } from '@utm/core';
import { EditGoogleEventDialog, type GoogleEditingCallbacks } from '../../calendar/EditGoogleEventDialog';
import {
  createId, evaluateFormulas, evaluateItemScripts, itemAreas, itemProjects, migrateItem, orderedListNames, orderedTagEntries, organizationAccentFor, organizationDefinitionFor, parsePortablePackage,
  type RecurrenceCompletionRecord, type Schedule, type UniversalItem, type WorkspaceDocument,
} from '@utm/core';
import { CodeEditor } from '../../../components/ui/CodeEditor';
import { CloseIcon, LineIcon } from '../../../components/ui/icons';
import { SearchableDisclosureList } from '../../../components/ui/SearchableDisclosureList';
import { Button, Checkbox, Field, Input, Select } from '../../../components/ui/primitives';
import { ResponsiveDialog } from '../../../components/ui/ResponsiveDialog';
import { SectionGuide } from '../../../components/ui/SectionGuide';
import { formatViewDate } from '../../../utils/dates';
import { calendarDurationMs, parseOptionalEstimateDuration, toIsoDuration, parseFriendlyDuration, scheduleWithDue, scheduleWithEnd, scheduleWithStart, type FriendlyDurationUnit } from '../../../utils/durations';
import { useWorkspaceNow } from '../../../hooks/useClock';
import { inferredPreset, stateNames } from '../fieldDisplay';
import { FieldIcon, FieldIconLabel } from '../FieldIcon';
import { normalizeItemForSave, withoutTemplateMarker } from './itemEditorModel';
import { ItemSection } from './ItemSection';
import { QuickItemTimer } from './QuickItemTimer';
import { DateTimeField } from './fields/DateTimeField';
import { DatesSection } from './sections/DatesSection';
import { RemindersSection } from './sections/RemindersSection';
import { RecurrenceSection } from './sections/RecurrenceSection';
import { ScriptsSection } from './sections/ScriptsSection';
import './item-editor-heading.css';
import { type GoogleCreationCallbacks } from '../../calendar/CreateGoogleEventDialog';
import { hasGoogleWriteAuthorization, requestGoogleCalendarToken } from '../../../services/googleCalendar';
import { writableGoogleCalendars } from '../../../services/googleCalendarCreate';
import { GOOGLE_SAVE_EXTENSION, itemGoogleBaseline, itemGoogleDraft, type GoogleSaveOptions } from '../../../services/googleItemSave';
import { GOOGLE_EDIT_EXTENSION, GoogleEditConflict, loadEditableGoogleEvent, rebaseGoogleEdit } from '../../../services/googleCalendarEdit';

type PortableFormat = 'json' | 'csv' | 'xlsx' | 'ics';
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const stopwatchDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600); const minutes = Math.floor((safe % 3600) / 60); const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
};

type TokenSuggestion = { value: string; meta?: string };
function TokenField({ label, values, draft, suggestions, placeholder, colorForValue, onDraft, onAdd, onRemove }: {
  label: string; values: string[]; draft: string; suggestions: TokenSuggestion[]; placeholder: string;
  colorForValue?: (value: string) => string | undefined;
  onDraft: (value: string) => void; onAdd: (value: string) => void; onRemove: (value: string) => void;
}) {
  const normalizedDraft = draft.trim().replace(/^#+/, '').toLocaleLowerCase();
  const visibleSuggestions = normalizedDraft ? suggestions.filter((suggestion) => suggestion.value.toLocaleLowerCase().includes(normalizedDraft)) : suggestions;
  const commitDraft = () => { const value = label === 'Tags' ? draft.trim().replace(/^#+/, '') : draft.trim(); if (value) onAdd(value); onDraft(''); };
  const keyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); event.stopPropagation(); commitDraft(); }
    else if (event.key === 'Backspace' && !draft && values.length) { event.preventDefault(); onRemove(values[values.length - 1]!); }
  };
  const iconPath = label === 'Areas' ? 'areas' : label === 'Projects' ? 'projects' : 'tags';
  return <Field label={<FieldIconLabel path={iconPath} label={label} />} optional><div className="organization-token-field">
    {values.length > 0 && <div className="organization-token-values">{values.map((value) => <Button size="compact" variant="ghost" key={value} aria-label={`Remove ${label.slice(0, -1)} ${value}`} onClick={() => onRemove(value)}><span style={colorForValue?.(value) ? { color: colorForValue(value) } : undefined}>{label !== 'Tags' && <FieldIcon path={iconPath} label={label} />}{label === 'Tags' ? '#' : ''}{value}</span><CloseIcon /></Button>)}</div>}
    <Input aria-label={`Add ${label.slice(0, -1)}`} value={draft} onChange={(event) => onDraft(event.target.value)} onKeyDown={keyDown} placeholder={placeholder} />
    {suggestions.length > 0 && <details className="organization-token-picker"><summary><FieldIcon path={iconPath} label={label} />Choose existing {label.toLowerCase()}…</summary><div className="organization-token-suggestions" aria-label={`${label} suggestions`}>{visibleSuggestions.map((suggestion) => <Button size="compact" variant="ghost" className={values.includes(suggestion.value) ? 'active' : ''} aria-pressed={values.includes(suggestion.value)} key={suggestion.value} onClick={() => values.includes(suggestion.value) ? onRemove(suggestion.value) : onAdd(suggestion.value)}><span style={colorForValue?.(suggestion.value) ? { color: colorForValue(suggestion.value) } : undefined}>{label === 'Tags' ? '#' : ''}{suggestion.value}</span>{suggestion.meta && <small>{suggestion.meta}</small>}</Button>)}</div></details>}
  </div></Field>;
}

export function ItemEditor({ initial, workspace, now: suppliedNow, isNew = false, onSave, onDelete, onCreateSubtask, onToggleSubtask, onReadPortableFile, onExportItem, onClose, onHistorySave, onGoogleEditDraft, onGoogleUpdated, onOpenOccurrence }: Partial<GoogleCreationCallbacks & GoogleEditingCallbacks> & {
  onOpenOccurrence?: (item: UniversalItem) => void;
  onHistorySave?: (item: UniversalItem) => void | Promise<void>;
  initial: UniversalItem; workspace: WorkspaceDocument; now?: Date; isNew?: boolean; onSave: (item: UniversalItem, options?: { convertedProject?: string; google?: GoogleSaveOptions }) => void | Promise<void>; onDelete: (item: UniversalItem) => void; onCreateSubtask: (title: string, parentId: string) => UniversalItem; onToggleSubtask: (id: string) => void; onUpdateRecurrenceCompletion: (record: RecurrenceCompletionRecord, completedAt: string) => { series: UniversalItem | undefined; rescheduled: boolean }; onReadPortableFile: (file: File) => Promise<string>; onExportItem: (item: UniversalItem, format: PortableFormat, metadata?: boolean) => void; onClose: () => void;
}) {
  const liveNow = useWorkspaceNow(workspace, 1_000, suppliedNow === undefined);
  const now = suppliedNow ?? liveNow;
  const [item, setItem] = useState(() => { const next = clean(googleCalendarProjection(initial)); initializeItemHistory(next); return next; });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [googleBaseline, setGoogleBaseline] = useState(() => clean(initial));
  const [googleConflict, setGoogleConflict] = useState(() => /changed in Google/.test(String((initial.extensions?.[GOOGLE_SAVE_EXTENSION] as { blocked?: string } | undefined)?.blocked ?? '')));
  const [googleRebased, setGoogleRebased] = useState(false);
  const [googleBusyValue, setGoogleBusyValue] = useState((initial.extensions?.[GOOGLE_SAVE_EXTENSION] as { draft?: { busy: boolean } } | undefined)?.draft?.busy ?? initial.external?.transparency !== 'transparent');
  const googlePreferences = workspace.calendarPreferences.googleCalendar;
  const [googleCalendarId, setGoogleCalendarId] = useState((initial.extensions?.[GOOGLE_SAVE_EXTENSION] as { destination?: string } | undefined)?.destination || initial.external?.calendarId || googlePreferences?.defaultCalendarId || googlePreferences?.calendars.find((c) => c.primary)?.id || '');
  const [calendarChoices, setCalendarChoices] = useState((googlePreferences?.calendars ?? []).filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer' || (!c.accessRole && c.primary)).map((c) => ({ id: c.id, summary: c.name })));
  const refreshCalendars = async () => {
    try { const token = await requestGoogleCalendarToken(undefined, 'create'); const choices = await writableGoogleCalendars(token.accessToken, googlePreferences?.accountEmail ?? ''); setCalendarChoices(choices.map((c) => ({ id: c.id!, summary: c.summary ?? c.id! }))); }
    catch (reason) { setError(String(reason)); }
  };
  useEffect(() => { if (googlePreferences && hasGoogleWriteAuthorization()) void refreshCalendars(); }, []);
  const [editingGoogle, setEditingGoogle] = useState(false);
  const titleFieldId = useId();
  const [tags, setTags] = useState(item.tags.join(', '));
  const [areaDraft, setAreaDraft] = useState('');
  const [projectDraft, setProjectDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [convertedProject, setConvertedProject] = useState<string>();
  const [contexts, setContexts] = useState(item.contexts.join(', '));
  const [recurring, setRecurring] = useState(item.role === 'series_template');
  const [repeatIntervalDraft, setRepeatIntervalDraft] = useState('1');
  const [error, setError] = useState('');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonDirty, setJsonDirty] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isTemplate, setIsTemplate] = useState(Boolean(item.extensions?.['utm:template']));
  const googleItem = googleActionItem(workspace, item);
  const googleLink = googleItem.external?.provider === 'google_calendar' ? googleItem.external : undefined;
  const googleEvent = googleLink?.readOnly ? googleLink : undefined;
  const titleInputRef = useRef<HTMLInputElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const suppressFocusRestore = useRef(false);
  // Quick-capture fields deliberately offer one fast second Enter.
  // As soon as the person explores another editor control, saving becomes an
  // explicit action so Enter can safely be used for tags and other fields.
  const quickTitleSaveAllowed = useRef(isNew);
  const quickTitleWasFocused = useRef(false);
  const retainedQuickCaptureFocus = useRef(typeof document !== 'undefined' && Boolean(document.activeElement?.closest('[data-quick-capture]'))).current;
  const templates = Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.extensions?.['utm:template'] === true && candidate.id !== item.id);
  const focusTitleOnOpen = typeof window !== 'undefined' && window.matchMedia('(min-width: 621px)').matches;
  // Parent links are stored on the parent item (parent -> child). Derive the
  // reverse side so a child always shows its parent in the editor.
  const parentItems = Object.values(workspace.items).filter((candidate) => !candidate.deletedAt && candidate.id !== item.id && candidate.relations.some((relation) => relation.type === 'parent' && relation.targetId === item.id));
  const applyTemplate = (template: UniversalItem) => {
    const identity = { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt, revision: item.revision, createdWithAppId: item.createdWithAppId, createdWithAppName: item.createdWithAppName, createdWithVersion: item.createdWithVersion };
    const next = clean({ ...template, ...identity, state: 'open' as const, role: 'standalone' as const, extensions: { ...template.extensions } });
    const cleanNext = withoutTemplateMarker(next);
    delete cleanNext.actualTimeEntries;
    delete cleanNext.completionEntries;
    delete cleanNext.timerHistory;
    delete cleanNext.cycleHistory;
    delete cleanNext.closure;
    delete cleanNext.occurrence;
    if (cleanNext.schedule) delete cleanNext.schedule.actualDuration;
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
  const patchRecurrence = (patch: Partial<NonNullable<UniversalItem['recurrence']>>) => setItem((current) => ({ ...current, recurrence: {
    rrule: current.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1', rdates: current.recurrence?.rdates ?? [], exdates: current.recurrence?.exdates ?? [],
    timezone: current.recurrence?.timezone ?? current.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, activationOffset: current.recurrence?.activationOffset ?? 'P7D',
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
  const scheduledDuration = parseOptionalEstimateDuration(item.schedule?.estimatedDuration);
  const travelDuration = parseOptionalEstimateDuration(item.schedule?.travelDuration);
  const transformSchedule = (transform: (schedule: Schedule) => Schedule) => {
    let next = { ...item, schedule: transform({ timezone: item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, ...item.schedule }) };
    if (item.eventProgram?.blocks.length) {
      if (!next.schedule.startAt || next.schedule.allDay) { setError('Remove the program before clearing Event opens or enabling All day.'); return; }
      const oldLength = Date.parse(item.schedule?.endAt ?? '') - Date.parse(item.schedule?.startAt ?? '');
      const length = Date.parse(next.schedule.endAt ?? '') - Date.parse(next.schedule.startAt);
      const affected = programOverflow(next);
      if (affected.length && length < oldLength) {
        const ru = workspace.calendarPreferences.language === 'ru';
        const description = affected.map((block) => `${block.title}: ${block.startOffsetSeconds * 1000 >= length ? (ru ? 'удалить' : 'delete') : (ru ? 'сократить' : 'shorten')}`).join('\n');
        if (!window.confirm(`${ru ? 'Сократить программу?' : 'Shorten program?'}\n${description}`)) return;
        try { next = { ...next, eventProgram: trimEventProgram(next).eventProgram! }; } catch (reason) { setError(String(reason)); return; }
      }
    }
    setItem(next);
  };
  const patchScheduledDuration = (amount: number | undefined, unit: FriendlyDurationUnit) => transformSchedule((schedule) => { const next = { ...schedule }; if (amount === undefined) delete next.estimatedDuration; else next.estimatedDuration = toIsoDuration(Math.max(1, amount), unit); return next; });
  const patchTravelDuration = (amount: number | undefined, unit: FriendlyDurationUnit) => transformSchedule((schedule) => { const next = { ...schedule }; if (amount === undefined || amount <= 0) delete next.travelDuration; else next.travelDuration = toIsoDuration(amount, unit); return next; });
  const patchScheduledStart = (value?: string) => { if (!value && (googleLink || googleItem.extensions?.[GOOGLE_SAVE_EXTENSION])) { setError('Linked events require both Event opens and Event ends.'); return; } transformSchedule((schedule) => {
    if (item.eventProgram?.blocks.length && value && schedule.startAt) {
      const delta = Date.parse(value) - Date.parse(schedule.startAt);
      return { ...schedule, startAt: value, ...(schedule.endAt ? { endAt: new Date(Date.parse(schedule.endAt) + delta).toISOString() } : {}) };
    }
    const next = scheduleWithStart(schedule, value); if (!value) delete next.travelDuration; return next;
  }); };
  const patchScheduledEnd = (value?: string) => { if (!value && (googleLink || googleItem.extensions?.[GOOGLE_SAVE_EXTENSION])) { setError('Linked events require both Event opens and Event ends.'); return; } transformSchedule((schedule) => scheduleWithEnd(schedule, value)); };
  const patchScheduledDue = (value?: string) => transformSchedule((schedule) => scheduleWithDue(schedule, value));
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
        transformSchedule((schedule) => ({ ...schedule, allDay: false, endAt: end.toISOString() }));
      }
    } else if (preset === 'all-day') {
      const start = item.schedule?.startAt ? new Date(item.schedule.startAt) : null;
      if (start) { start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); transformSchedule((schedule) => ({ ...schedule, allDay: true, startAt: start.toISOString(), endAt: end.toISOString() })); }
    }
    else if (preset) patchScheduledDuration(Number(preset), 'minutes');
  };
  const selectedAreas = itemAreas(item);
  const selectedProjects = itemProjects(item);
  const selectedTags = commaList(tags);
  const areaNames = [...new Set([...Object.keys(workspace.areaDefinitions), ...Object.values(workspace.items).flatMap(itemAreas)])];
  const projectNames = [...new Set([...Object.keys(workspace.projectDefinitions), ...Object.values(workspace.items).flatMap(itemProjects)])];
  const projectAreas = (project: string) => organizationDefinitionFor(workspace, 'project', project)?.areas ?? [];
  const relatedAreas = new Set(selectedProjects.flatMap(projectAreas));
  const relatedProjects = new Set(projectNames.filter((project) => projectAreas(project).some((area) => selectedAreas.includes(area))));
  const suggestionOrder = (kind: 'area' | 'project', selected: string[], related: Set<string>) => (left: string, right: string) => {
    const tier = (value: string) => selected.includes(value) ? 0 : related.has(value) ? 1 : 2;
    const difference = tier(left) - tier(right); if (difference) return difference;
    const definitions = kind === 'area' ? workspace.areaDefinitions : workspace.projectDefinitions;
    return Date.parse(definitions[right]?.createdAt ?? '') - Date.parse(definitions[left]?.createdAt ?? '') || left.localeCompare(right);
  };
  const areaSuggestions: TokenSuggestion[] = areaNames.sort(suggestionOrder('area', selectedAreas, relatedAreas)).map((value) => {
    const related = selectedProjects.filter((project) => projectAreas(project).includes(value));
    return related.length ? { value, meta: `Contains: ${related.join(', ')}` } : { value };
  });
  const projectSuggestions = projectNames.sort(suggestionOrder('project', selectedProjects, relatedProjects)).map((value) => ({
    value, meta: projectAreas(value).length ? `In: ${projectAreas(value).join(', ')}` : 'No Area',
  }));
  const knownTags = orderedTagEntries(workspace).filter((tag): tag is string => tag !== null);
  const collectedTags = [...new Set([...selectedTags, ...knownTags])];
  const toggleTag = (tag: string) => setTags((current) => {
    const values = commaList(current);
    return (values.includes(tag) ? values.filter((value) => value !== tag) : [...values, tag]).join(', ');
  });
  const addArea = (area: string) => patchItem({ areas: [...new Set([...selectedAreas, area.trim()].filter(Boolean))] });
  const removeArea = (area: string) => patchItem({ areas: selectedAreas.filter((value) => value !== area) });
  const addProject = (project: string) => {
    const value = project.trim(); if (!value) return;
    patchItem({ projects: [...new Set([...selectedProjects, value])], areas: [...new Set([...selectedAreas, ...projectAreas(value)])] });
  };
  const removeProject = (project: string) => patchItem({ projects: selectedProjects.filter((value) => value !== project) });
  const convertItemToProject = () => {
    const project = item.title.trim(); if (!project) return;
    addProject(project); setConvertedProject(project);
  };
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

  const save = async ({ dismissKeyboard = false }: { dismissKeyboard?: boolean } = {}) => {
    if (savingRef.current) return; savingRef.current = true; setSaving(true); setError('');
    try {
      if (dismissKeyboard) {
        // Base UI normally restores focus to the quick-capture input when this
        // dialog closes. That would immediately reopen the iOS keyboard.
        suppressFocusRestore.current = true;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
      const normalized = normalizeItemForSave({ item, workspace, tags, contexts, isTemplate, recurring, activeRange, repeatFrequency, repeatIntervalDraft, repeatDays, now });
      recordCompletionTransition(normalized, initial.state, now.toISOString());
      await onSave(normalized, { ...(convertedProject ? { convertedProject } : {}), ...(googlePreferences && !isTemplate && normalized.schedule?.startAt && normalized.schedule.endAt ? { google: { calendarId: googleCalendarId, busy: googleBusyValue, baseline: googleBaseline, rebased: googleRebased } } : {}) });
    } catch (reason) { setGoogleConflict(reason instanceof GoogleEditConflict); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  useEffect(() => {
    const saveFromRetainedMobileKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      const target = event.target;
      if (!quickTitleSaveAllowed.current || !item.title.trim() || !(target instanceof HTMLInputElement) || !target.closest('[data-quick-capture]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      quickTitleSaveAllowed.current = false;
      save({ dismissKeyboard: true });
    };
    window.addEventListener('keydown', saveFromRetainedMobileKeyboard, true);
    return () => window.removeEventListener('keydown', saveFromRetainedMobileKeyboard, true);
  });

  useLayoutEffect(() => {
    if (!retainedQuickCaptureFocus) return;
    titleInputRef.current?.focus({ preventScroll: true });
    editorScrollRef.current?.parentElement?.scrollTo({ top: 0, behavior: 'instant' });
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

  if (googleLink && editingGoogle && onGoogleEditDraft && onGoogleUpdated) return <EditGoogleEventDialog item={googleItem} workspace={workspace} onClose={() => setEditingGoogle(false)} onGoogleEditDraft={onGoogleEditDraft} onGoogleUpdated={async (event) => { await onGoogleUpdated(event); if (googleEvent) onClose(); else setEditingGoogle(false); }} />;
  if (googleEvent) return <ResponsiveDialog open title="Google Calendar event" ariaLabel="Google Calendar properties" onOpenChange={(open) => { if (!open) onClose(); }} footer={<><Button onClick={onClose}>Close</Button>{onGoogleEditDraft && onGoogleUpdated && <Button disabled={!workspace.calendarPreferences.googleCalendar?.allowPastEventEditing && !workspace.items[item.id]?.extensions?.[GOOGLE_EDIT_EXTENSION] && (!item.schedule?.endAt || Date.now() > Date.parse(item.schedule.endAt) + 3 * 3600_000)} onClick={() => setEditingGoogle(true)}>{workspace.calendarPreferences.language === 'ru' ? 'Редактировать' : 'Edit event'}</Button>}</>}>
    <h2>{item.title}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{item.bodyMarkdown}</p>
    <dl className="google-create-preview">
      <dt>Location</dt><dd>{item.location || '—'}</dd>
      <dt>Calendar</dt><dd>{workspace.calendarPreferences.googleCalendar?.calendars.find((calendar) => calendar.id === googleEvent.calendarId)?.name || googleEvent.calendarId}</dd>
      <dt>Event opens</dt><dd>{item.schedule?.startAt ? formatViewDate(item.schedule.startAt, !item.schedule.allDay, workspace.calendarPreferences.language) : '—'}</dd>
      <dt>{item.schedule?.allDay ? 'First day after the event' : 'Event ends'}</dt><dd>{item.schedule?.endAt ? formatViewDate(item.schedule.endAt, !item.schedule.allDay, workspace.calendarPreferences.language) : '—'}</dd>
      <dt>Timezone</dt><dd>{Intl.DateTimeFormat().resolvedOptions().timeZone}</dd>
      <dt>All day</dt><dd>{item.schedule?.allDay ? 'Yes' : 'No'}</dd>
      <dt>Availability</dt><dd>{googleEvent.transparency === 'transparent' ? 'Free' : 'Busy'}</dd>
      <dt>Time statistics</dt><dd>{item.schedule?.allDay ? 'Excluded — all-day event' : googleEvent.transparency === 'transparent' ? 'Excluded — marked free' : 'Included — reserves its Event opens → Event ends interval'}</dd>
    </dl><a className="secondary button-link" href={googleEvent.sourceUrl} target="_blank" rel="noreferrer">Open in Google Calendar</a>
    <EventProgramSection item={item} onChange={(next) => {
      if (next.schedule?.startAt !== item.schedule?.startAt || next.schedule?.endAt !== item.schedule?.endAt) { setError('Change the event boundaries using Edit event first.'); return; }
      setItem(next);
    }} language={workspace.calendarPreferences.language} now={now} />
    {error && <p role="alert">{error}</p>}
    <Button disabled={saving} onClick={() => void save()}>{workspace.calendarPreferences.language === 'ru' ? 'Сохранить элемент' : 'Save item'}</Button>
    <ItemHistoryJournals item={item} workspace={workspace} onChange={async (next) => { await onHistorySave?.(next); setItem(next); }} />
  </ResponsiveDialog>;

  return <ResponsiveDialog open onOpenChange={(open) => { if (!open && !savingRef.current) onClose(); }} title={<><span className="eyebrow">UNIVERSAL ITEM</span><span className="item-editor-heading">{workspace.items[item.id] ? 'Edit item' : 'New item'}</span></>} ariaLabel="Item editor" className="item-editor-dialog" initialFocus={retainedQuickCaptureFocus ? titleInputRef : false} finalFocus={() => suppressFocusRestore.current ? false : undefined} closeLabel="Close item editor" footer={<div className="item-editor-actions">{workspace.items[item.id] && <Button variant="secondary" disabled={saving} onClick={() => onDelete(item)}>Delete</Button>}<span /><button className="secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save item'}</button></div>}>
    <div className="editor-scroll" ref={editorScrollRef} onFocusCapture={(event) => {
      if (event.target === titleInputRef.current) quickTitleWasFocused.current = true;
      else if (quickTitleWasFocused.current) quickTitleSaveAllowed.current = false;
    }} onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return;
      if (!quickTitleSaveAllowed.current || event.target !== titleInputRef.current || !item.title.trim()) return;
      event.preventDefault();
      quickTitleSaveAllowed.current = false;
      save({ dismissKeyboard: true });
    }}>
        <div className="item-title-field">
          <div className="item-title-heading"><label htmlFor={titleFieldId}><FieldIconLabel path="title" label="Title" /></label>{!googleEvent && <Checkbox checked={Boolean(item.isNote)} onChange={(event) => patchItem({ isNote: event.target.checked || undefined })} label="Note" />}</div>
          <input id={titleFieldId} ref={titleInputRef} autoFocus={focusTitleOnOpen} readOnly={Boolean(googleEvent)} value={item.title} onChange={(event) => patchItem({ title: event.target.value })} placeholder="What needs to happen?" />
          {!googleEvent && item.isNote && <p className="schedule-explainer">Notes stay visible and editable, but cannot be marked completed.</p>}
        </div>
        {googlePreferences && !isTemplate && item.schedule?.startAt && item.schedule.endAt && !googleEvent && <>
          <Field label="Google Calendar"><Select aria-label="Google Calendar" value={googleCalendarId} onChange={(event) => setGoogleCalendarId(event.target.value)}>
            <option value="">Choose calendar</option>
            {calendarChoices.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
            {googleCalendarId && !calendarChoices.some((c) => c.id === googleCalendarId) && <option value={googleCalendarId}>{googlePreferences.calendars.find((c) => c.id === googleCalendarId)?.name ?? googleCalendarId}</option>}
          </Select></Field>
          <Button variant="ghost" disabled={saving} onClick={() => void refreshCalendars()}>Refresh calendars</Button>
          <Checkbox label="Busy" checked={googleBusyValue} onChange={(event) => setGoogleBusyValue(event.target.checked)} />
        </>}
        {Boolean(item.extensions?.['utm:googleSave']) && <p role="status">{workspace.calendarPreferences.language === 'ru' ? 'Сохранено в UTM, ожидает синхронизации.' : 'Saved in UTM, waiting for sync.'}{String((item.extensions!['utm:googleSave'] as { blocked?: string }).blocked ?? '')}</p>}
        <QuickItemTimer soundEnabled onCountTime={async (record) => {
          const owner = item.role === 'series_template' ? Object.values(workspace.items).find((entry) => !entry.deletedAt && entry.occurrence?.seriesId === item.id && entry.state === 'open') : undefined;
          const target = clean(owner ?? item); addTimerActualTime(target, record);
          if (owner && onHistorySave) await onHistorySave(target); else patchItem({ actualTimeEntries: target.actualTimeEntries, completionEntries: target.completionEntries, schedule: target.schedule });
        }} onRecord={(record) => {
          const owner = item.role === 'series_template' ? Object.values(workspace.items).find((entry) => !entry.deletedAt && entry.occurrence?.seriesId === item.id && entry.state === 'open') : undefined;
          if (owner && onHistorySave) void Promise.resolve(onHistorySave({ ...clean(owner), timerHistory: [...(owner.timerHistory ?? []).filter((entry) => entry.id !== record.id), { ...record, recurrenceId: owner.occurrence!.recurrenceId }] })).catch((reason) => setError(String(reason)));
          else patchItem({ timerHistory: [...(item.timerHistory ?? []).filter((entry) => entry.id !== record.id), { ...record, ...(item.occurrence ? { recurrenceId: item.occurrence.recurrenceId } : {}) }] });
        }} />
        {isNew && templates.length > 0 && <SearchableDisclosureList uiKey="item-editor:saved-templates" className="template-picker" summary={<><FieldIconLabel path="isTemplate" label="Choose a saved template" /> <span>Optional</span></>} items={templates} getSearchText={(template) => template.title} searchLabel="Search saved templates" searchPlaceholder="Search templates" description={<p className="schedule-explainer">Pick a template to prefill this new item. Nothing changes until you select one, and you can edit every field before saving.</p>} renderItem={(template) => <button type="button" className="template-option" key={template.id} onClick={(event) => { applyTemplate(template); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{template.title || 'Untitled template'}</button>} />}
        <EventProgramSection item={item} onChange={setItem} language={workspace.calendarPreferences.language} now={now} occurrences={item.role === 'series_template' ? Object.values(workspace.items).filter((entry) => !entry.deletedAt && entry.occurrence?.seriesId === item.id) : []} onOpenOccurrence={onOpenOccurrence ? (target) => {
          if (JSON.stringify(item) !== JSON.stringify(initial) && !window.confirm(workspace.calendarPreferences.language === 'ru' ? 'Открыть отдельное повторение? Несохранённые изменения текущей формы будут отменены.' : 'Open an occurrence? Unsaved changes in this form will be discarded.')) return;
          onOpenOccurrence(target);
        } : undefined} />
        <DatesSection item={item} workspace={workspace} sectionMark={sectionMark} {...(scheduledDuration ? { scheduledDuration } : {})} {...(travelDuration ? { travelDuration } : {})} patchScheduledDuration={patchScheduledDuration} patchTravelDuration={patchTravelDuration} patchScheduledStart={patchScheduledStart} patchScheduledEnd={patchScheduledEnd} patchScheduledDue={patchScheduledDue} applyDurationPreset={applyDurationPreset}>
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

        <ItemSection sectionKey="organization" title="Organization" iconPath="list" filledMark={sectionMark(Boolean(selectedAreas.length || selectedProjects.length || item.list || selectedTags.length))}>
          <div className="form-grid two organization-fields">
            <TokenField label="Areas" values={selectedAreas} draft={areaDraft} suggestions={areaSuggestions} placeholder="Choose or create an Area" colorForValue={(value) => organizationAccentFor(workspace, 'area', value)} onDraft={setAreaDraft} onAdd={addArea} onRemove={removeArea} />
            <TokenField label="Projects" values={selectedProjects} draft={projectDraft} suggestions={projectSuggestions} placeholder="Choose or create a Project" colorForValue={(value) => organizationAccentFor(workspace, 'project', value)} onDraft={setProjectDraft} onAdd={addProject} onRemove={removeProject} />
            <Field label="Task list" optional><div className="creation-default-choice"><SearchableDisclosureList uiKey={`item-editor:task-list:${item.id}`} className="item-list-picker" summary={item.list || 'Choose existing Task list…'} items={orderedListNames(workspace)} getSearchText={(name) => name} searchLabel="Search Task lists" searchPlaceholder="Search Task lists" emptyText="No Task lists yet." noMatchesText="No matching Task lists." renderItem={(name) => <Button size="compact" variant="ghost" key={name} aria-pressed={item.list === name} onClick={(event) => { patchItem({ list: name }); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{name}</Button>} /><Input aria-label="Create Task list" value={item.list ?? ''} onChange={(event) => patchItem({ list: event.target.value.trim() || undefined })} placeholder="Or create a new list" /></div></Field>
          </div>
          <TokenField label="Tags" values={selectedTags} draft={tagDraft} suggestions={collectedTags.map((value) => ({ value }))} placeholder="Add a tag and press Enter" colorForValue={(value) => organizationAccentFor(workspace, 'tag', value)} onDraft={setTagDraft} onAdd={(tag) => { if (!selectedTags.includes(tag)) setTags([...selectedTags, tag].join(', ')); }} onRemove={(tag) => { if (selectedTags.includes(tag)) toggleTag(tag); }} />
          <div className="organization-convert"><Button size="compact" onClick={convertItemToProject} disabled={!item.title.trim() || convertedProject === item.title.trim()}>{convertedProject === item.title.trim() ? 'Item will be kept in this Project' : 'Convert item to Project'}</Button></div>
        </ItemSection>

        <details className="description-section"><summary><FieldIconLabel path="bodyMarkdown" label="Description" /> {sectionMark(Boolean(item.bodyMarkdown.trim() || item.attachments.length))}</summary><div className="details-body">
          <label><span className="hint">Markdown</span><textarea rows={5} value={item.bodyMarkdown} onChange={(event) => patchItem({ bodyMarkdown: event.target.value })} placeholder="Context, links, checklists…" /></label>
          {item.bodyMarkdown && <details className="markdown-details"><summary>Markdown preview</summary><div className="markdown preview"><ReactMarkdown>{item.bodyMarkdown}</ReactMarkdown></div></details>}
          <div className="description-file-links"><FieldIconLabel path="attachments" label="Files (links only)" />{item.attachments.map((attachment) => <div className="chip" key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.title ?? attachment.url}</a><button aria-label="Remove file link" onClick={() => patchItem({ attachments: item.attachments.filter((entry) => entry.id !== attachment.id) })}><CloseIcon /></button></div>)}<button className="secondary" onClick={() => { const url = window.prompt('File URL'); if (url) patchItem({ attachments: [...item.attachments, { id: createId(), url }] }); }}>+ Add file link</button></div>
        </div></details>

        <ItemSection sectionKey="history" title="History" iconPath="cycleHistory">
          <ItemHistoryJournals item={item} workspace={workspace} onChange={setItem} {...(onHistorySave ? { onOwnerChange: onHistorySave } : {})} />
        </ItemSection>
        <ItemSection sectionKey="more" title="More" iconPath="custom">
          <details><summary><FieldIconLabel path="location" label="Location" /> {sectionMark(Boolean(item.location))}</summary><div className="details-body"><Field label="Location" optional hint="Reserved for future calendar event data."><Input aria-label="Location" value={item.location ?? ''} onChange={(event) => patchItem({ location: event.target.value || undefined })} placeholder="Add a location" /></Field></div></details>
        <ItemSection sectionKey="template" title="Template" iconPath="isTemplate" filledMark={sectionMark(isTemplate)}><Checkbox checked={isTemplate} onChange={(event) => setIsTemplate(event.target.checked)} label="Save this item as a template" /><p className="schedule-explainer">Templates are kept in the same workspace but do not appear in ordinary lists. They can be selected only while creating a new item.</p></ItemSection>

        <details><summary><FieldIconLabel path="subtasks" label="Subtasks" /> {sectionMark(item.relations.some((relation) => relation.type === 'parent'))}</summary><div className="details-body">
          <p className="schedule-explainer">Add existing items as steps of this item. Subtasks remain independent universal items and can be completed or edited on their own.</p>
          {item.relations.filter((relation) => relation.type === 'parent').map((relation) => {
            const subtask = workspace.items[relation.targetId];
            const completed = subtask?.state === 'done';
            return <div className={`subtask-row${completed ? ' completed' : ''}`} key={relation.id}>
              {subtask && !canManuallyComplete(subtask)
                ? <span className="subtask-note-marker" aria-label={`Note: ${subtask.title}`}><LineIcon name="note" /></span>
                : <button type="button" className={`subtask-check${completed ? ' checked' : ''}`} aria-label={`${completed ? 'Reopen' : 'Complete'} subtask ${subtask?.title ?? relation.targetId}`} onClick={() => onToggleSubtask(relation.targetId)}>{completed ? '✓' : ''}</button>}
              <span className="subtask-title">{subtask?.title ?? relation.targetId}</span>
              <button type="button" aria-label="Remove subtask" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button>
            </div>;
          })}
          <div className="inline-row"><input aria-label="New subtask title" value={newSubtaskTitle} onChange={(event) => setNewSubtaskTitle(event.target.value)} placeholder="New subtask title" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title, item.id); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); } }} /><button className="secondary" onClick={() => { const title = newSubtaskTitle.trim(); if (!title) return; const subtask = onCreateSubtask(title, item.id); patchItem({ relations: [...item.relations, { id: createId(), targetId: subtask.id, type: 'parent' }] }); setNewSubtaskTitle(''); }}>Add subtask</button></div>
        </div></details>

        <ItemSection sectionKey="status" title="Status" iconPath="state" filledMark={sectionMark(item.state !== 'open')}><Field label="Item status" hint="Status normally changes through completion, cancellation, auto-renew or archiving."><Select aria-label="Item status" disabled={!canManuallyComplete(item)} value={item.state} onChange={(event) => { const state = event.target.value as UniversalItem['state']; patchItem({ state, closure: state === 'open' ? undefined : { at: item.closure?.at ?? now.toISOString(), actor: item.closure?.actor ?? 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' } }); }}>{['open', 'done', 'cancelled', 'auto_closed', 'archived'].map((state) => <option key={state} value={state}>{stateNames[state as UniversalItem['state']]}</option>)}</Select></Field>{(item.state === 'done' || item.state === 'cancelled') && <label>Actually {item.state === 'done' ? 'completed' : 'cancelled'} at {dateField(`Actually ${item.state === 'done' ? 'completed' : 'cancelled'} at`, item.closure?.at, (value) => { if (value) patchItem({ closure: { at: value, actor: item.closure?.actor ?? 'user', reason: item.state === 'cancelled' ? 'cancelled' : 'manual' } }); else patchItem({ closure: undefined }); }, 'Defaults to now. Change this when you are recording the item after it happened. For a completion-anchored series, the next cycle uses this time when this cycle is first closed.')}</label>}</ItemSection>

        <details><summary><FieldIconLabel path="relations" label="Relations & links" /> {sectionMark(item.relations.length > 0 || parentItems.length > 0)}</summary><div className="details-body">
          <SectionGuide title="Linking items"><p>Relations connect two items without making either one a subtask. Links are URL references only; files are not stored in this workspace.</p></SectionGuide>
          {parentItems.map((parent) => <div className="chip" key={`parent-${parent.id}`}><span>Parent: {parent.title}</span><small className="hint">This item is a subtask</small></div>)}
          {item.relations.map((relation) => <div className="chip" key={relation.id}>{relation.type}: {workspace.items[relation.targetId]?.title ?? relation.targetId}<button aria-label="Remove relation" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>)}
          <SearchableDisclosureList uiKey={`item-editor:relations:${item.id}`} className="relation-picker" summary="Choose related item…" items={Object.values(workspace.items).filter((candidate) => candidate.id !== item.id && !candidate.deletedAt)} getSearchText={(candidate) => candidate.title} searchLabel="Search related items" searchPlaceholder="Search items" emptyText="No other items yet." renderItem={(candidate) => <Button size="compact" variant="ghost" key={candidate.id} onClick={(event) => { if (!item.relations.some((relation) => relation.targetId === candidate.id && relation.type === 'related')) patchItem({ relations: [...item.relations, { id: createId(), targetId: candidate.id, type: 'related' }] }); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{candidate.title || 'Untitled item'}</Button>} />
        </div></details>

        <ScriptsSection scripts={item.scripts ?? []} onChange={(scripts) => patchItem({ scripts: scripts.length ? scripts : undefined })} scriptResults={scriptResults} onEditProgram={() => { const section = editorScrollRef.current?.querySelector<HTMLDetailsElement>('.event-program'); if (section) { section.open = true; section.scrollIntoView({ block: 'nearest' }); } }} />
        {definitions.length > 0 && <details><summary><FieldIconLabel path="custom" label="Custom fields" /> {sectionMark(Object.keys(item.custom).length > 0)}</summary><div className="details-body">{definitions.map((field) => <label key={field.id}><FieldIconLabel path={`custom.${field.key}`} label={field.label} />{field.kind === 'formula' ? <output className="formula-output">{String(formulas.values[field.key] ?? formulas.errors[field.key] ?? '—')}</output> : <input value={String(item.custom[field.key] ?? '')} onChange={(event) => patchItem({ custom: { ...item.custom, [field.key]: field.kind === 'number' ? Number(event.target.value) : field.kind === 'boolean' ? event.target.value === 'true' : event.target.value } })} />}</label>)}</div></details>}
        <details><summary><FieldIconLabel path="system.json" label="Item JSON" /> {sectionMark(jsonDirty)}</summary><div className="details-body json-editor"><p className="hint">Edit the same item draft as the form. Protected identity, provenance, timestamps and occurrence fields are preserved when updating an existing item.</p><SectionGuide title="JSON safety"><p>Apply JSON updates the form first; only Save item writes it to the workspace. Import as new item always creates a separate copy. Exported data is readable, so do not share it accidentally.</p></SectionGuide><CodeEditor language="json" ariaLabel="Item JSON" rows={18} value={jsonDraft} onChange={(value) => { setJsonDraft(value); setJsonDirty(true); }} /><div className="builder-actions"><button className="secondary compact-action" onClick={() => { setJsonDraft(JSON.stringify(item, null, 2)); setJsonDirty(false); }}>Refresh from form</button><button className="secondary compact-action" onClick={applyJson}>Apply JSON to form</button><details className="inline-menu"><summary>Export…</summary><div><button onClick={exportItemJson}>JSON</button><button onClick={() => exportItem('csv')}>CSV</button><button onClick={() => exportItem('xlsx')}>Excel</button><button onClick={() => exportItem('ics')}>iCalendar</button><button onClick={() => exportItem('ics', true)}>iCalendar + UTM metadata</button></div></details><button className="secondary compact-action" onClick={() => importJsonRef.current?.click()}>Import as new item</button><input ref={importJsonRef} hidden type="file" accept=".json,.csv,.xlsx,.ics,application/json,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => event.target.files?.[0] && void importAsNew(event.target.files[0])} /></div></div></details>
        <details><summary><FieldIconLabel path="system" label="System metadata" /></summary><div className="details-body metadata-grid"><div><span>Created at</span><output><time dateTime={item.createdAt}>{formatViewDate(item.createdAt, true, workspace.calendarPreferences.language)}</time></output></div><div><span>Last modified</span><output><time dateTime={item.updatedAt}>{formatViewDate(item.updatedAt, true, workspace.calendarPreferences.language)}</time></output></div><div><span>Created by application</span><output>{item.createdWithAppName} v{item.createdWithVersion}</output></div><div><span>Application ID</span><output className="mono">{item.createdWithAppId}</output></div><div><span>Item schema</span><output>{item.schemaVersion}</output></div><div><span>Item ID</span><output>{item.id}</output></div></div></details>
        </ItemSection>
      {error && <p className="editor-error error" role="alert">{error}</p>}
      {googleConflict && <Button disabled={saving} onClick={async () => {
        const link = googleBaseline.external; if (!link || !googlePreferences) return;
        try {
          const token = await requestGoogleCalendarToken(undefined, 'create');
          const { event, timeZone } = await loadEditableGoogleEvent(token.accessToken, link.calendarId, link.eventId, googlePreferences.accountEmail ?? '');
          const merged = rebaseGoogleEdit({ calendarId: link.calendarId, eventId: link.eventId, accountEmail: googlePreferences.accountEmail ?? '', baseline: (workspace.items[item.id]?.extensions?.[GOOGLE_SAVE_EXTENSION] as { baseline?: GoogleCalendarEvent } | undefined)?.baseline ?? itemGoogleBaseline(googleBaseline), draft: itemGoogleDraft(item, googleBusyValue) }, event, timeZone);
          const remote = googleCalendarEventToItem(event, link.calendarId, link.connectionId, new Date().toISOString(), timeZone)!;
          setGoogleBaseline({ ...googleBaseline, title: remote.title, bodyMarkdown: remote.bodyMarkdown, location: remote.location ?? '', schedule: { ...googleBaseline.schedule, ...remote.schedule, timezone: timeZone }, external: { ...link, etag: event.etag!, startAt: remote.schedule!.startAt!, endAt: remote.schedule!.endAt!, timezone: timeZone, allDay: merged.allDay, transparency: event.transparency ?? 'opaque' } });
          const mergedEvent = googleCalendarEventToItem({ id: event.id, summary: merged.title, description: merged.description, location: merged.location, start: merged.allDay ? { date: merged.start, timeZone: merged.timeZone } : { dateTime: merged.start, timeZone: merged.timeZone }, end: merged.allDay ? { date: merged.end, timeZone: merged.timeZone } : { dateTime: merged.end, timeZone: merged.timeZone } }, link.calendarId, link.connectionId, new Date().toISOString(), merged.timeZone)!;
          setItem((current) => ({ ...current, title: merged.title, bodyMarkdown: merged.description, location: merged.location, schedule: { ...current.schedule, startAt: mergedEvent.schedule!.startAt!, endAt: mergedEvent.schedule!.endAt!, allDay: merged.allDay, timezone: merged.timeZone } }));
          setGoogleBusyValue(merged.busy); setGoogleRebased(true); setGoogleConflict(false); setError('');
        } catch (reason) { setError(String(reason)); }
      }}>Load current event; keep my draft</Button>}
    </div>
  </ResponsiveDialog>;
}
