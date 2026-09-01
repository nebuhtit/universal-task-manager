import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  compileSort, createId, effectiveItemDurationMs, effectiveWorkspaceNow, ensureAreaDefinition, ensureListDefinition, ensureProjectDefinition, ensureTagDefinition, evaluateScriptsForItem, inferViewPeriod, migrateView, orderedListNames, orderedOrganizationNames, orderedTagEntries, organizationAccentFor, organizationDefinitionFor, parseExpression, parsePortablePackage, parseSortSource, serializeSortRules, validateScriptDefinitions, validateViewCreationDefaults,
  type ProjectedOccurrence, type SavedView, type UniversalItem, type ViewSortRule, type WorkspaceDocument,
} from '@utm/core';
import { CodeEditor } from '../../components/ui/CodeEditor';
import { CloseIcon } from '../../components/ui/icons';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { SearchableDisclosureList } from '../../components/ui/SearchableDisclosureList';
import { Button, Checkbox, Disclosure, Field, IconButton, Input, Select, Textarea } from '../../components/ui/primitives';
import { SectionGuide } from '../../components/ui/SectionGuide';
import { readUiBoolean } from '../../components/ui/PersistedDetails';
import { useReorderList } from '../../components/ui/useReorderList';
import { dateInput, fromDateInput } from '../../utils/dates';
import { diagnosticFailureCode, recordDiagnostic } from '../../services/diagnostics';
import { stateNames } from '../items';
import { FieldIcon } from '../items/FieldIcon';
import { ScriptsSection } from '../items/editor/sections/ScriptsSection';
import { SavedViewSection } from './SavedViewSection';
import { boardSettingsFor, defaultBoardStates, MANUAL_ORDER_EXTENSION, manualOrderFor, mergeManualOrder, type BoardSettings } from './viewSelectors';
import { exampleViewFieldValue, viewFieldGroups, viewFieldLabel, viewFieldOptions } from './fieldCatalog';
import { creationDefaultFieldOptions, defaultValueForPath } from './creationDefaults';
import { defaultSchedulePeriodValue, parseSchedulePeriodValue, parseVisualRows, schedulePeriodField, serializeVisualRows, toSqlExpression, visualFieldKinds, visualOperators, visualOptions, type SchedulePeriodValue, type VisualConditionRow } from './visualFilterModel';
import { DisplayedFieldsEditor } from './DisplayedFieldsEditor';
import { ViewSortingEditor } from './ViewSortingEditor';
import { ViewPortabilityEditor } from './ViewPortabilityEditor';
import { ViewEditorSection } from './ViewEditorSection';
import { modernizeLegacyViewScope } from './legacyViewScope';
import { BUILT_IN_VIEW_TEMPLATES, isViewTemplate, VIEW_TEMPLATE_EXTENSION, VIEW_TEMPLATE_FIELDS, viewFromTemplate } from './viewTemplates';
import './views-editor.css';

type PortableFormat = 'json' | 'csv' | 'xlsx' | 'ics';
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const orderedSavedViews = (workspace: WorkspaceDocument) => {
  const listed = workspace.viewOrder ?? [];
  const known = new Set(Object.keys(workspace.views));
  return [...listed.filter((id) => known.has(id)), ...Object.keys(workspace.views).filter((id) => !listed.includes(id))]
    .map((id) => workspace.views[id]!).filter((view) => !isViewTemplate(view));
};

const viewAccentOptions = [
  { value: '#d9485f', label: 'Coral' }, { value: '#c27a00', label: 'Amber' }, { value: '#087f73', label: 'Teal' },
  { value: '#2864c7', label: 'Blue' }, { value: '#7048b8', label: 'Violet' }, { value: '#b83280', label: 'Berry' },
  { value: '#a45116', label: 'Rust' }, { value: '#8a6a00', label: 'Gold' }, { value: '#2f7d32', label: 'Green' },
  { value: '#147a55', label: 'Mint' }, { value: '#007c91', label: 'Cyan' }, { value: '#4254a6', label: 'Indigo' },
  { value: '#8d3f78', label: 'Plum' }, { value: '#5d6470', label: 'Slate' },
] as const;

const scheduleSourceOptions: Array<{ value: SchedulePeriodValue['sources'][number]; label: string }> = [
  { value: 'event_open', label: 'Event opens in period' },
  { value: 'event', label: 'Event opens → Event ends overlaps period' },
  { value: 'active', label: 'Event opens → Due overlaps period' },
  { value: 'due', label: 'Due in period' },
];

function SchedulePeriodEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const current = parseSchedulePeriodValue(value);
  const update = (patch: Partial<SchedulePeriodValue>) => onChange(JSON.stringify({ ...current, ...patch }));
  const toggleSource = (source: SchedulePeriodValue['sources'][number], checked: boolean) => {
    const sources = checked ? [...new Set([...current.sources, source])] : current.sources.filter((candidate) => candidate !== source);
    if (sources.length) update({ sources });
  };
  return <div className="schedule-period-editor">
    <Select aria-label="Schedule period" value={current.period} onChange={(event) => update({ period: event.target.value as SchedulePeriodValue['period'] })}>
      <option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="this_week">This week</option><option value="next_week">Next week</option><option value="next_days">Next N days</option><option value="custom">Custom period</option>
    </Select>
    {current.period === 'next_days' && <Input aria-label="Number of days" type="number" min={1} value={current.nextDays} onChange={(event) => update({ nextDays: Math.max(1, Number(event.target.value) || 1) })} />}
    {current.period === 'custom' && <div className="schedule-custom-period"><Input aria-label="Custom period starts" type="date" value={current.customStart} onChange={(event) => update({ customStart: event.target.value })} /><Input aria-label="Custom period ends" type="date" value={current.customEnd} onChange={(event) => update({ customEnd: event.target.value })} /></div>}
    <div className="schedule-period-sources" aria-label="Schedule dates to match">{scheduleSourceOptions.map((option) => <Checkbox key={option.value} checked={current.sources.includes(option.value)} onChange={(event) => toggleSource(option.value, event.target.checked)} label={option.label} />)}</div>
    <Checkbox checked={current.includeOverdue} onChange={(event) => update({ includeOverdue: event.target.checked })} label="Include overdue" />
    <small className="field-hint">Matches any selected schedule condition. Overdue means an unfinished item whose Due is earlier than now.</small>
  </div>;
}

export function ViewsPage({ workspace, commit, onEditItem, onState, onOpenCalendar, onAddItem, onExportView, celebrationColors, createRequest = 0 }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state'], celebrationColor?: string) => void;
  onOpenCalendar?: (viewId: string) => void; onAddItem: (view: SavedView) => void; onExportView: (view: SavedView, mode: 'definition' | 'results' | 'bundle', format?: PortableFormat, metadata?: boolean) => void; celebrationColors?: ReadonlyMap<string, string> | undefined; createRequest?: number;
}) {
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [error, setError] = useState('');
  const [visualRows, setVisualRows] = useState<VisualConditionRow[]>([]);
  const [visualDirty, setVisualDirty] = useState(false);
  const [sortRules, setSortRules] = useState<ViewSortRule[]>([]);
  const [sortSource, setSortSource] = useState('');
  const [defaultField, setDefaultField] = useState('priority');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewJson, setViewJson] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('builtin:inbox');
  const [templateName, setTemplateName] = useState('');
  const [templateArea, setTemplateArea] = useState(() => orderedOrganizationNames(workspace, 'area')[0] ?? '');
  const [templateProject, setTemplateProject] = useState(() => orderedOrganizationNames(workspace, 'project')[0] ?? '');
  const [viewExpansion, setViewExpansion] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.values(workspace.views).map((view) => [view.id, readUiBoolean(`view:${view.id}`, true)])));
  const handledCreateRequest = useRef(createRequest);
  const lastEditorId = useRef<string | null>(null);
  const editorOpenedAt = useRef<number | null>(null);
  const closeEditor = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setEditing(null);
  };

  useEffect(() => {
    const previousId = lastEditorId.current;
    const nextId = editing?.id ?? null;
    if (previousId === nextId) return;
    const durationMs = !nextId && editorOpenedAt.current !== null ? Math.round(performance.now() - editorOpenedAt.current) : undefined;
    recordDiagnostic({
      kind: nextId ? 'action' : 'result',
      message: nextId ? 'View editor state opened' : 'View editor state closed',
      operation: 'View editor lifecycle',
      outcome: nextId ? 'started' : 'succeeded',
      ...(durationMs !== undefined ? { durationMs } : {}),
      details: JSON.stringify({ viewId: nextId ?? previousId, source: nextId ? 'react-state' : 'state-cleared' }),
    });
    editorOpenedAt.current = nextId ? performance.now() : null;
    lastEditorId.current = nextId;
  }, [editing?.id]);

  useEffect(() => {
    if (!editing) return undefined;
    let lastPresent: boolean | undefined;
    let lastRowCount = -1;
    const inspect = () => {
      const popup = document.querySelector('.ui-dialog-popup.view-editor');
      const present = Boolean(popup);
      const rowCount = popup?.querySelectorAll('.visual-condition-row').length ?? 0;
      if (present === lastPresent && rowCount === lastRowCount) return;
      recordDiagnostic({
        kind: present ? 'result' : 'error',
        message: present ? 'View editor DOM visible' : 'View editor DOM missing while state is open',
        operation: 'View editor visibility',
        outcome: present ? 'succeeded' : 'failed',
        details: JSON.stringify({ viewId: editing.id, present, renderedFilterRows: rowCount, expectedFilterRows: visualRows.length }),
      });
      lastPresent = present;
      lastRowCount = rowCount;
    };
    const frame = window.requestAnimationFrame(inspect);
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [editing?.id, visualRows.length]);

  useEffect(() => {
    if (!editing) return;
    let filterValid = true;
    let failure = '';
    try { parseExpression(editing.query.source.trim() || 'true'); }
    catch (reason) { filterValid = false; failure = diagnosticFailureCode(reason); }
    recordDiagnostic({
      kind: filterValid ? 'action' : 'error',
      message: filterValid ? 'View filter draft changed' : 'View filter draft is invalid',
      operation: 'Edit view filter',
      outcome: filterValid ? 'started' : 'failed',
      details: JSON.stringify({ viewId: editing.id, sourceLength: editing.query.source.length, visualRows: visualRows.length, visualDirty, fields: visualRows.map((row) => row.field), operators: visualRows.map((row) => row.operator), ...(failure ? { failure } : {}) }),
    });
  }, [editing?.id, editing?.query.source, visualDirty, visualRows]);

  const syncRowsToDsl = (rows: VisualConditionRow[]) => {
    if (!editing) return;
    setVisualRows(rows);
    setVisualDirty(false);
    setEditing({ ...editing, query: { source: serializeVisualRows(rows) } });
  };
  const beginEditing = (view: SavedView, templateId = 'builtin:inbox') => {
    const copy = modernizeLegacyViewScope(clean(view));
    copy.fields ??= [];
    copy.sort ??= [];
    const source = copy.sortSource ?? serializeSortRules(copy.sort.map((sort) => ({ expression: sort.field, direction: sort.direction, nulls: sort.nulls ?? 'last' })));
    const rows = parseVisualRows(copy.query.source);
    recordDiagnostic({
      kind: 'action', message: 'Open view editor requested', operation: 'View editor lifecycle', outcome: 'started',
      details: JSON.stringify({ viewId: copy.id, renderer: copy.renderer, sourceLength: copy.query.source.length, parsedVisualRows: rows?.length ?? 0, visualDslCompatible: rows !== null, displayedFields: copy.fields.length }),
    });
    setEditing(copy);
    setVisualRows(rows ?? []);
    setVisualDirty(rows === null);
    setSortSource(source);
    try { setSortRules(parseSortSource(source)); } catch { setSortRules([]); }
    setDefaultField('priority');
    setConfirmDelete(false);
    setViewJson(JSON.stringify(copy, null, 2));
    setSelectedTemplateId(templateId);
    setTemplateName(`${copy.name} template`);
    setError('');
  };
  const addVisualRow = (join: 'and' | 'or') => syncRowsToDsl([...visualRows, { id: createId(), join, field: 'state', operator: '==', value: 'open' }]);
  const addSchedulePeriodRow = () => syncRowsToDsl([...(visualDirty ? [] : visualRows), { id: createId(), join: 'and', field: schedulePeriodField, operator: 'matches', value: JSON.stringify(defaultSchedulePeriodValue()) }]);
  const startVisualRows = () => syncRowsToDsl([{ id: createId(), join: 'and', field: 'state', operator: '==', value: 'open' }]);
  const updateVisualRow = (id: string, patch: Partial<VisualConditionRow>) => {
    const rows = visualRows.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (patch.field) {
        const options = visualOperators(patch.field);
        next.operator = options.includes(next.operator) ? next.operator : options[0]!;
        next.value = patch.field === schedulePeriodField ? JSON.stringify(defaultSchedulePeriodValue()) : visualOptions[patch.field]?.[0] ?? '';
      }
      return next;
    });
    syncRowsToDsl(rows);
  };
  const updateSortRules = (next: ViewSortRule[]) => {
    setSortRules(next);
    setSortSource(serializeSortRules(next));
  };
  const updateBoardSettings = (patch: Partial<BoardSettings>) => {
    if (!editing) return;
    const current = boardSettingsFor(editing);
    setEditing({ ...editing, extensions: { ...editing.extensions, 'utm:board': { ...current, ...patch } } });
  };
  const boardStates = editing ? boardSettingsFor(editing).states : [];
  const boardReorder = useReorderList(boardStates, (states) => updateBoardSettings({ states }));
  const updateCreationDefaults = (next: Record<string, unknown>) => {
    if (!editing) return;
    setEditing(Object.keys(next).length ? { ...editing, creationDefaults: next } : (() => { const { creationDefaults: _defaults, ...withoutDefaults } = editing; return withoutDefaults; })());
  };
  const addCreationDefault = () => {
    if (!editing || editing.creationDefaults?.[defaultField] !== undefined) return;
    updateCreationDefaults({ ...editing.creationDefaults, [defaultField]: defaultValueForPath(workspace, defaultField) });
  };
  const replaceCreationDefaultPath = (oldPath: string, path: string) => {
    if (!editing || oldPath === path) return;
    const next = { ...editing.creationDefaults }; delete next[oldPath];
    if (!(path in next)) next[path] = defaultValueForPath(workspace, path);
    updateCreationDefaults(next);
  };
  const setCreationDefaultValue = (path: string, value: unknown) => updateCreationDefaults({ ...(editing?.creationDefaults ?? {}), [path]: value });
  const existingOrNewDefault = (path: 'area' | 'project' | 'list', value: unknown, options: string[], noun: string) => {
    const current = String(value ?? '');
    const known = options.includes(current);
    const kind = path === 'area' ? 'area' : path === 'project' ? 'project' : undefined;
    const typed = known ? '' : current;
    const useNewValue = () => {
      const next = typed.trim();
      if (next) setCreationDefaultValue(path, next);
    };
    return <div className="creation-default-choice">
      <SearchableDisclosureList uiKey={`view-editor:creation-default:${editing?.id}:${path}`} className="creation-default-organization-choice" summary={<span aria-label={`Choose existing ${noun}`} style={known && kind ? { color: organizationAccentFor(workspace, kind, current) } : undefined}>{known ? <><FieldIcon path={path} label={noun} />{current}</> : `Choose existing ${noun}…`}</span>} items={options} getSearchText={(option) => option} searchLabel={`Search ${noun}s`} searchPlaceholder={`Search ${noun}s`} emptyText={`No ${noun}s yet.`} noMatchesText={`No matching ${noun}s.`} renderItem={(option) => <Button size="compact" variant="ghost" role="option" aria-selected={option === current} style={kind ? { color: organizationAccentFor(workspace, kind, option) } : undefined} key={option} onClick={(event) => { setCreationDefaultValue(path, option); event.currentTarget.closest('details')?.removeAttribute('open'); }}><FieldIcon path={path} label={noun} />{option}</Button>} />
      <form className="creation-default-new-value" onSubmit={(event) => { event.preventDefault(); useNewValue(); }}><Input aria-label={`Type new ${noun}`} value={typed} placeholder={`Or type a new ${noun}`} onChange={(event) => setCreationDefaultValue(path, event.target.value)} /><Button type="submit" size="compact" disabled={!typed.trim()}>Use new {noun}</Button></form>
    </div>;
  };
  const creationDefaultControl = (path: string, value: unknown): ReactNode => {
    const custom = path.startsWith('custom.') ? workspace.customFields[path.slice(7)] : undefined;
    const json = ['reminders', 'attachments', 'recurrence.rdates', 'recurrence.exdates'].includes(path);
    if (json) return <Textarea className="mono creation-default-json" aria-label={`Default value for ${path}`} defaultValue={JSON.stringify(value, null, 2)} onBlur={(event) => { try { setCreationDefaultValue(path, JSON.parse(event.currentTarget.value)); setError(''); } catch { setError(`${viewFieldLabel(workspace, path)} must contain valid JSON.`); } }} />;
    if (path === 'state') return <Select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}>{Object.entries(stateNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</Select>;
    if (path === 'progress.mode') return <Select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="boolean">Boolean</option><option value="percent">Percent</option><option value="counter">Counter</option></Select>;
    if (path === 'habit.streakMode') return <Select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="manual_only">Manual only</option><option value="any_closed">Any closed</option></Select>;
    if (path === 'recurrence.closeAt') return <Select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="next_activation">Next activation</option><option value="due">Due</option><option value="never">Never</option></Select>;
    if (path === 'recurrence.anchor') return <Select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value)}><option value="schedule">Scheduled time</option><option value="completion">Completion time</option></Select>;
    if (['schedule.allDay', 'recurrence.autoRenew'].includes(path) || custom?.kind === 'boolean') return <Select value={String(value)} onChange={(event) => setCreationDefaultValue(path, event.target.value === 'true')}><option value="true">True</option><option value="false">False</option></Select>;
    if (path === 'area') return existingOrNewDefault('area', value, orderedOrganizationNames(workspace, 'area'), 'Area');
    if (path === 'project') {
      const area = typeof editing?.creationDefaults?.area === 'string' ? editing.creationDefaults.area : undefined;
      const related = area ? orderedOrganizationNames(workspace, 'project', area) : [];
      const all = orderedOrganizationNames(workspace, 'project');
      return existingOrNewDefault('project', value, [...related, ...all.filter((project) => !related.includes(project))], 'Project');
    }
    if (path === 'list') return existingOrNewDefault('list', value, orderedListNames(workspace), 'list');
    if (path === 'tags') {
      const values = Array.isArray(value) ? value.map(String) : [];
      const available = orderedTagEntries(workspace).filter((tag): tag is string => tag !== null && !values.includes(tag));
      return <div className="creation-default-choice"><SearchableDisclosureList uiKey={`view-editor:creation-default:${editing?.id}:tags`} summary="Add existing Tag…" items={available} getSearchText={(tag) => tag} searchLabel="Search Tags" searchPlaceholder="Search Tags" emptyText="No more Tags available." noMatchesText="No matching Tags." renderItem={(tag) => <Button size="compact" variant="ghost" key={tag} onClick={(event) => { setCreationDefaultValue(path, [...values, tag]); event.currentTarget.closest('details')?.removeAttribute('open'); }}>#{tag}</Button>} /><Input value={values.join(', ')} placeholder="Choose above or type comma-separated Tags" onChange={(event) => setCreationDefaultValue(path, commaList(event.target.value).map((tag) => tag.replace(/^#+/, '')))} /></div>;
    }
    if (path === 'contexts' || custom?.kind === 'multi_enum') return <Input value={Array.isArray(value) ? value.join(', ') : ''} placeholder="Comma-separated values" onChange={(event) => setCreationDefaultValue(path, commaList(event.target.value))} />;
    if (['priority', 'progress.current', 'progress.target', 'habit.target'].includes(path) || custom?.kind === 'number') return <Input type="number" value={Number(value)} onChange={(event) => setCreationDefaultValue(path, Number(event.target.value))} />;
    if (path.startsWith('schedule.') && (path.endsWith('At') || path === 'schedule.availableFrom')) return <Input type="datetime-local" value={dateInput(String(value))} onChange={(event) => setCreationDefaultValue(path, fromDateInput(event.target.value))} />;
    return <Input value={String(value ?? '')} onChange={(event) => setCreationDefaultValue(path, event.target.value)} />;
  };
  const statistics = editing?.statistics ?? { showTime: true, reservedItemIds: [] };
  const statisticsPeriod = editing ? inferViewPeriod(editing, effectiveWorkspaceNow(workspace), { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn }) : null;
  const reservedCandidates = Object.values(workspace.items)
    .filter((item) => !item.deletedAt && item.role !== 'occurrence' && Boolean(item.schedule) && effectiveItemDurationMs(item) > 0)
    .sort((left, right) => left.title.localeCompare(right.title));
  const updateStatistics = (showTime: boolean, reservedItemIds = statistics.reservedItemIds) => {
    if (!editing) return;
    setEditing({ ...editing, statistics: { showTime, reservedItemIds: [...new Set(reservedItemIds)] } });
  };
  const toggleReservedItem = (id: string, checked: boolean) => updateStatistics(statistics.showTime, checked ? [...statistics.reservedItemIds, id] : statistics.reservedItemIds.filter((candidate) => candidate !== id));
  const scriptPreviewItem = Object.values(workspace.items).find((item) => !item.deletedAt);
  const viewScriptResults = editing && scriptPreviewItem
    ? evaluateScriptsForItem(scriptPreviewItem, editing.scripts ?? [], (id) => workspace.items[id], effectiveWorkspaceNow(workspace))
    : { values: {}, errors: {} };
  const updateViewScripts = (scripts: NonNullable<SavedView['scripts']>) => {
    if (!editing) return;
    const keys = new Set(scripts.map((script) => script.key));
    const fields = editing.fields.filter((field) => !field.startsWith('view_script.') || keys.has(field.slice(12)));
    setEditing(scripts.length ? { ...editing, scripts, fields } : (() => { const { scripts: _scripts, ...withoutScripts } = editing; return { ...withoutScripts, fields: fields.filter((field) => field !== 'view_scripts') }; })());
  };
  const save = () => {
    if (!editing) return;
    const result = editing;
    const startedAt = performance.now();
    recordDiagnostic({
      kind: 'action', message: 'View save validation started', operation: 'Save view editor', outcome: 'started',
      details: JSON.stringify({ viewId: result.id, renderer: result.renderer, sourceLength: result.query.source.length, visualRows: visualRows.length, visualDirty, displayedFields: result.fields.length, sortRules: sortRules.length }),
    });
    try {
      parseExpression(result.query.source.trim() || 'true');
      validateScriptDefinitions(result.scripts ?? []);
      const defaultsValidation = validateViewCreationDefaults(result.creationDefaults);
      if (!defaultsValidation.valid) throw new Error(defaultsValidation.errors.join('; '));
      const parsedSort = parseSortSource(sortSource);
      compileSort(sortSource);
      const saved = { ...result, sortSource: serializeSortRules(parsedSort), sort: parsedSort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) };
      commit('Save view', (draft) => {
        draft.views[result.id] = clean(saved);
        const defaultArea = typeof result.creationDefaults?.area === 'string' ? result.creationDefaults.area.trim() : '';
        const defaultProject = typeof result.creationDefaults?.project === 'string' ? result.creationDefaults.project.trim() : '';
        const defaultList = typeof result.creationDefaults?.list === 'string' ? result.creationDefaults.list.trim() : '';
        if (defaultList) ensureListDefinition(draft, defaultList, { kind: 'list' });
        if (defaultArea) ensureAreaDefinition(draft, defaultArea);
        if (defaultProject) {
          const current = draft.projectDefinitions[defaultProject];
          ensureProjectDefinition(draft, defaultProject, defaultArea ? { areas: [...new Set([...(current?.areas ?? []), defaultArea])] } : {});
        }
        if (Array.isArray(result.creationDefaults?.tags)) result.creationDefaults.tags.forEach((tag) => ensureTagDefinition(draft, String(tag)));
      });
      recordDiagnostic({
        kind: 'result', message: 'View editor save accepted', operation: 'Save view editor', outcome: 'succeeded', durationMs: Math.round(performance.now() - startedAt),
        details: JSON.stringify({ viewId: result.id, renderer: result.renderer, displayedFields: saved.fields.length, sortRules: parsedSort.length }),
      });
      closeEditor();
      setError('');
    } catch (reason) {
      recordDiagnostic({
        kind: 'error', message: 'View editor save validation failed', operation: 'Save view editor', outcome: 'failed', durationMs: Math.round(performance.now() - startedAt),
        details: JSON.stringify({ viewId: result.id, failure: diagnosticFailureCode(reason), sourceLength: result.query.source.length, visualRows: visualRows.length, visualDirty, sortSourceLength: sortSource.length }),
      });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const newView = () => beginEditing({ id: createId(), name: 'New view', query: { source: '(state == "open" || state == "done") && isTemplate != true' }, renderer: 'table', sort: [{ field: 'organizationOrder', direction: 'desc', nulls: 'last' }, { field: 'updatedAt', direction: 'desc', nulls: 'last' }], sortSource: 'organizationOrder desc nulls last\nupdatedAt desc nulls last', fields: [...VIEW_TEMPLATE_FIELDS] });
  useEffect(() => {
    if (createRequest === handledCreateRequest.current) return;
    handledCreateRequest.current = createRequest;
    newView();
  }, [createRequest]);
  const applyViewJson = (source = viewJson) => {
    if (!editing) return;
    try {
      const raw = JSON.parse(source) as unknown;
      const imported = migrateView(raw && typeof raw === 'object' && (raw as { format?: string }).format === 'utm-portable' ? parsePortablePackage(source).package.views[0] : raw, 'editor:view-json').value;
      const next = { ...imported, id: editing.id };
      beginEditing(next); setViewJson(JSON.stringify(next, null, 2)); setError('');
    } catch (reason) { setError(`View JSON was not applied: ${reason instanceof Error ? reason.message : String(reason)}`); }
  };
  const importViewTemplate = async (file: File) => { const source = await file.text(); setViewJson(source); applyViewJson(source); };

  const userTemplates = Object.values(workspace.views).filter(isViewTemplate);
  const availableTemplates = [...BUILT_IN_VIEW_TEMPLATES, ...userTemplates];
  const selectedTemplate = availableTemplates.find((template) => template.id === selectedTemplateId);
  const applySelectedTemplate = () => {
    if (!editing || !selectedTemplate) return;
    const next = viewFromTemplate(selectedTemplate, editing.id);
    if (selectedTemplate.id === 'builtin:some-area') {
      if (templateArea) next.area = templateArea; else delete next.area;
      delete next.project;
    }
    if (selectedTemplate.id === 'builtin:some-project') {
      if (templateProject) {
        next.project = templateProject;
        const definition = organizationDefinitionFor(workspace, 'project', templateProject);
        if (definition && 'areas' in definition && definition.areas[0]) next.area = definition.areas[0];
      } else delete next.project;
    }
    beginEditing(next, selectedTemplate.id);
  };
  const saveCurrentAsTemplate = () => {
    if (!editing || !templateName.trim()) return;
    try {
      parseExpression(editing.query.source.trim() || 'true');
      validateScriptDefinitions(editing.scripts ?? []);
      const parsedSort = parseSortSource(sortSource); compileSort(sortSource);
      const id = createId();
      const extensions: Record<string, unknown> = { ...editing.extensions, [VIEW_TEMPLATE_EXTENSION]: true };
      delete extensions[MANUAL_ORDER_EXTENSION];
      const saved: SavedView = { ...clean(editing), id, name: templateName.trim(), sortSource: serializeSortRules(parsedSort), sort: parsedSort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })), extensions };
      commit('Save view template', (draft) => { draft.views[id] = clean(saved); });
      setSelectedTemplateId(id);
      setTemplateName(`${editing.name} template`);
      setError('');
    } catch (reason) { setError(`Template was not saved: ${reason instanceof Error ? reason.message : String(reason)}`); }
  };

  const views = orderedSavedViews(workspace);
  const isExpanded = (view: SavedView) => viewExpansion[view.id] ?? readUiBoolean(`view:${view.id}`, true);
  const renderView = (view: SavedView, reorderHandle?: ReactNode) => <div className="saved-view-slot" key={view.id}>{view.renderer === 'calendar' && onOpenCalendar && <button className="open-calendar-button" onClick={() => onOpenCalendar(view.id)}>Open {view.name} in Calendar</button>}<SavedViewSection view={view} workspace={workspace} initialOpen={isExpanded(view)} onOpenChange={(open) => setViewExpansion((current) => ({ ...current, [view.id]: open }))} onEditView={() => beginEditing(view)} onEditItem={onEditItem} onState={onState} onAddItem={onAddItem} onReorderItems={(itemIds) => commit('Set manual view order', (draft) => { const target = draft.views[view.id]; if (!target) return; target.extensions ??= {}; target.extensions[MANUAL_ORDER_EXTENSION] = mergeManualOrder(target, itemIds, new Set(Object.values(draft.items).filter((item) => !item.deletedAt).map((item) => item.id))); })} onResetOrder={() => commit('Reset manual view order', (draft) => { const target = draft.views[view.id]; if (!target?.extensions || !manualOrderFor(target).length) return; delete target.extensions[MANUAL_ORDER_EXTENSION]; })} celebrationColors={celebrationColors} showTechnicalSummary={false} reorderHandle={reorderHandle} onRendererChange={(renderer) => commit('Change view renderer', (draft) => { const target = draft.views[view.id]; if (target) target.renderer = renderer; })} /></div>;
  const expandedViews = views.filter(isExpanded);
  const collapsedViews = views.filter((view) => !isExpanded(view));
  const collapsedViewReorder = useReorderList(collapsedViews, (next) => {
    const movedIds = new Set(collapsedViews.map((view) => view.id));
    commit('Reorder collapsed Views', (draft) => {
      const current = [...(draft.viewOrder ?? []), ...Object.keys(draft.views).filter((id) => !(draft.viewOrder ?? []).includes(id))];
      const replacement = next.map((view) => view.id);
      let index = 0;
      draft.viewOrder = current.map((id) => movedIds.has(id) ? replacement[index++]! : id);
    });
  });

  return <section className="page-section views-page">
    <div className="views-stack"><div className="expanded-views-stack">{expandedViews.map((view) => renderView(view))}</div>{collapsedViews.length > 0 && <div className="collapsed-views-stack" ref={collapsedViewReorder.container}>{collapsedViews.map((view, index) => <div key={view.id} {...collapsedViewReorder.rowProps(index)}>{renderView(view, collapsedViewReorder.handle(index, `view ${view.name}`))}</div>)}</div>}</div>
    {editing && <ResponsiveDialog
      open
      onOpenChange={(open) => { if (!open) { recordDiagnostic({ kind: 'action', message: 'View editor close requested', operation: 'View editor lifecycle', outcome: 'started', details: JSON.stringify({ viewId: editing.id, reason: 'dialog-dismiss' }) }); closeEditor(); } }}
      title="Edit view"
      description="Saved view"
      className="view-editor"
      closeLabel="Close view editor"
      initialFocus={false}
      finalFocus={typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches ? false : undefined}
      footer={<><Button variant="destructive" onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } commit('Delete view', (draft) => { delete draft.views[editing.id]; Object.values(draft.dashboards).forEach((dashboard) => { for (let index = dashboard.widgets.length - 1; index >= 0; index -= 1) if (dashboard.widgets[index]?.viewId === editing.id) dashboard.widgets.splice(index, 1); }); }); closeEditor(); setConfirmDelete(false); }}>{confirmDelete ? 'Confirm delete' : 'Delete view'}</Button><span className="view-editor-action-spacer" /><Button onClick={() => { recordDiagnostic({ kind: 'action', message: 'View editor close requested', operation: 'View editor lifecycle', outcome: 'started', details: JSON.stringify({ viewId: editing.id, reason: 'cancel-button' }) }); closeEditor(); }}>Cancel</Button><Button variant="primary" onClick={save}>Save view</Button></>}
    >
      <Field label="Name"><Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field>
      <Field label="Renderer"><Select value={editing.renderer} onChange={(event) => setEditing({ ...editing, renderer: event.target.value as SavedView['renderer'] })}><option>list</option><option>table</option><option>calendar</option><option>board</option></Select></Field>
      <ViewEditorSection sectionKey="templates" title="View templates"><fieldset className="view-template-picker"><div className="view-template-apply"><Field label="Template"><SearchableDisclosureList uiKey={`view-editor:templates:${editing.id}`} summary={selectedTemplate?.name ?? 'Choose template…'} items={availableTemplates} getSearchText={(template) => template.name} searchLabel="Search View templates" searchPlaceholder="Search templates" renderItem={(template) => <Button size="compact" variant="ghost" key={template.id} aria-pressed={template.id === selectedTemplateId} onClick={(event) => { setSelectedTemplateId(template.id); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{template.name}</Button>} /></Field>{selectedTemplateId === 'builtin:some-area' && <Field label="Area"><SearchableDisclosureList uiKey={`view-editor:template-area:${editing.id}`} summary={templateArea || 'Choose Area…'} items={orderedOrganizationNames(workspace, 'area')} getSearchText={(area) => area} searchLabel="Search Areas" searchPlaceholder="Search Areas" renderItem={(area) => <Button size="compact" variant="ghost" key={area} onClick={(event) => { setTemplateArea(area); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{area}</Button>} /></Field>}{selectedTemplateId === 'builtin:some-project' && <Field label="Project"><SearchableDisclosureList uiKey={`view-editor:template-project:${editing.id}`} summary={templateProject || 'Choose Project…'} items={orderedOrganizationNames(workspace, 'project')} getSearchText={(project) => project} searchLabel="Search Projects" searchPlaceholder="Search Projects" renderItem={(project) => <Button size="compact" variant="ghost" key={project} onClick={(event) => { setTemplateProject(project); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{project}</Button>} /></Field>}<Button size="compact" disabled={!selectedTemplate || (selectedTemplateId === 'builtin:some-area' && !templateArea) || (selectedTemplateId === 'builtin:some-project' && !templateProject)} onClick={applySelectedTemplate}>Apply template</Button></div><div className="view-template-save"><Field label="Save current View as template"><Input aria-label="Template name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" /></Field><Button size="compact" disabled={!templateName.trim()} onClick={saveCurrentAsTemplate}>Save as template</Button></div></fieldset></ViewEditorSection>
      <ViewEditorSection sectionKey="color" title="View color"><fieldset className="view-accent-picker"><p className="builder-status">This color identifies the view and completed ticks. Each option stays readable in light and dark themes.</p><div className="view-accent-options"><Button size="compact" className={`view-accent-option view-accent-default${!editing.accent ? ' selected' : ''}`} aria-label="Default view color" aria-pressed={!editing.accent} onClick={() => { const { accent: _accent, ...withoutAccent } = editing; setEditing(withoutAccent); }}><span aria-hidden /></Button>{viewAccentOptions.map((option) => <Button size="compact" key={option.value} className={`view-accent-option${editing.accent === option.value ? ' selected' : ''}`} aria-label={`${option.label} view color`} aria-pressed={editing.accent === option.value} onClick={() => setEditing({ ...editing, accent: option.value })}><span aria-hidden style={{ backgroundColor: option.value }} /></Button>)}<label className="view-custom-accent" aria-label="Custom view color" style={{ backgroundColor: editing.accent ?? '#2864c7' }}><input type="color" value={editing.accent ?? '#2864c7'} onChange={(event) => setEditing({ ...editing, accent: event.target.value })} /></label></div></fieldset></ViewEditorSection>
      <SectionGuide title="How views work"><ul><li>A view is a saved, live list; it never copies items.</li><li>Use the visual setup below: first choose which items appear, then choose what is shown for each item.</li><li>The optional advanced filter code below is synchronized with ordinary rows whenever its logic can be represented visually.</li><li>An empty filter means all items except recurring source templates. Sorting only controls order.</li></ul></SectionGuide>
      <ViewEditorSection sectionKey="visual-setup" title="Visual setup"><fieldset className="query-builder visual-query-builder">
        <h3 className="query-builder-heading">1. Filter items</h3>
        <p className="builder-status">Build the filter with ordinary fields, operators and values. The result and advanced code update immediately. Active range uses Event opens through Due.</p>
        {visualRows.map((row, index) => <div className="visual-condition-row" key={row.id}>
          <Field className="condition-join" label={index === 0 ? 'Where' : 'Join'}>{index === 0 ? <span className="field-hint">First rule</span> : <Select value={row.join} onChange={(event) => updateVisualRow(row.id, { join: event.target.value as 'and' | 'or' })}><option value="and">AND</option><option value="or">OR</option></Select>}</Field>
          <Field label="Property"><Select value={row.field} onChange={(event) => updateVisualRow(row.id, { field: event.target.value })}><optgroup label="Time periods"><option value={schedulePeriodField}>Schedule in period</option></optgroup>{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup label={group} key={group}>{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option value={field.path} key={field.path}>{field.label}</option>)}</optgroup>)}</Select></Field>
          {row.field === schedulePeriodField ? <Field className="schedule-period-condition" label="Match any selected condition (OR)"><SchedulePeriodEditor value={row.value} onChange={(value) => updateVisualRow(row.id, { value })} /></Field> : <><Field label="Operator"><Select value={row.operator} onChange={(event) => updateVisualRow(row.id, { operator: event.target.value })}>{visualOperators(row.field).map((operator) => <option key={operator} value={operator}>{operator}</option>)}</Select></Field>
          <Field label="Value">{row.operator === 'is set' || row.operator === 'is not set' ? <span className="field-hint">No value needed</span> : visualOptions[row.field] ? <Select value={row.value} onChange={(event) => updateVisualRow(row.id, { value: event.target.value })}>{visualOptions[row.field]!.map((value) => <option key={value} value={value}>{row.field === 'state' ? stateNames[value as UniversalItem['state']] ?? value : value}</option>)}</Select> : <Input type={row.field.startsWith('schedule.') ? 'datetime-local' : 'text'} list={row.field === 'title' ? 'view-title-values' : row.field === 'tags' || row.field === 'contexts' ? 'view-tag-values' : undefined} placeholder={row.field === 'tags' || row.field === 'contexts' ? 'Choose or type comma-separated values' : undefined} value={row.value} onChange={(event) => updateVisualRow(row.id, { value: event.target.value })} />}</Field></>}
          <IconButton size="compact" variant="ghost" className="visual-condition-remove" aria-label={`Remove filter rule ${index + 1}`} onClick={() => syncRowsToDsl(visualRows.filter((entry) => entry.id !== row.id))}><CloseIcon /></IconButton>
        </div>)}
        <datalist id="view-title-values">{[...new Set(Object.values(workspace.items).map((entry) => entry.title))].map((title) => <option value={title} key={title} />)}</datalist>
        <datalist id="view-tag-values">{[...new Set(Object.values(workspace.items).flatMap((entry) => [...entry.tags, ...entry.contexts]))].sort().map((tag) => <option value={tag} key={tag} />)}</datalist>
        {visualDirty ? <p className="builder-status">This filter uses advanced code that cannot be shown as ordinary rows. Adding a visual rule replaces that code.</p> : <p className="builder-status">The visual rows and advanced filter code are synchronized.</p>}
        <div className="builder-actions"><Button size="compact" onClick={addSchedulePeriodRow}>+ Add time period</Button><Button size="compact" onClick={() => visualDirty ? startVisualRows() : addVisualRow('and')}>+ Add AND rule</Button><Button size="compact" onClick={() => visualDirty ? startVisualRows() : addVisualRow('or')}>+ Add OR rule</Button></div>
      </fieldset></ViewEditorSection>
      <ViewEditorSection sectionKey="scripts" title="Scripts"><fieldset className="view-scripts-settings">
        <ScriptsSection embedded scope="view" scripts={editing.scripts ?? []} onChange={updateViewScripts} scriptResults={viewScriptResults} />
        <small className="field-hint">Live result uses the first available workspace item as a preview. Select the generated View-script fields in “Show in results” to display them for every matching item.</small>
      </fieldset></ViewEditorSection>
      <ViewEditorSection sectionKey="show-in-results" title="Show in results"><DisplayedFieldsEditor workspace={workspace} view={editing} onChange={setEditing} /></ViewEditorSection>
      <ViewEditorSection sectionKey="statistics" title="Statistics"><fieldset className="view-statistics-settings">
        <Checkbox checked={statistics.showTime} onChange={(event) => updateStatistics(event.target.checked)} label="Show time statistics" />
        <p className="builder-status">Completion is weighted by Duration. Remaining time includes unfinished items in this view.</p>
        {statisticsPeriod ? <p className="view-statistics-period">Capacity period: <strong>{statisticsPeriod.startDate === statisticsPeriod.endDate ? statisticsPeriod.startDate : `${statisticsPeriod.startDate} – ${statisticsPeriod.endDate}`}</strong></p> : <p className="view-statistics-period">Free time unavailable: add one finite Schedule in period rule.</p>}
        <p className="builder-status">Free time is the whole period minus this view's planned Duration and the reserved items below.</p>
        <SearchableDisclosureList uiKey={`view-editor:statistics-reserved:${editing.id}`} className="view-statistics-reserved" summary={<span className="view-statistics-reserved-summary"><span>Reserved items</span><small>{statistics.reservedItemIds.length} selected</small></span>} items={reservedCandidates} getSearchText={(item) => item.title} searchLabel="Search reserved items" searchPlaceholder="Search items" emptyText="No scheduled items with Duration yet." noMatchesText="No matching items." renderItem={(item) => <Checkbox key={item.id} checked={statistics.reservedItemIds.includes(item.id)} onChange={(event) => toggleReservedItem(item.id, event.target.checked)} label={<>{item.title}{item.role === 'series_template' && <small> · repeats</small>}</>} />}/>
        <small className="field-hint">A recurring item is counted once for every occurrence inside the view period. If its occurrence is already in the view, it is not subtracted twice.</small>
      </fieldset></ViewEditorSection>
      <ViewEditorSection sectionKey="advanced-filter" title="Advanced filter code"><Field className="dsl-field" label="Advanced filter code" hint={<>Optional text form of the visual rows. SQL preview: {toSqlExpression(editing.query.source)}</>}><CodeEditor language="dsl" ariaLabel="Advanced filter code" rows={5} value={editing.query.source} onChange={(value) => { const rows = parseVisualRows(value); setEditing({ ...editing, query: { source: value } }); if (rows !== null) setVisualRows(rows); setVisualDirty(rows === null); }} /></Field></ViewEditorSection>
      <ViewEditorSection sectionKey="creation-defaults" title="Defaults for new items"><fieldset className="query-builder creation-defaults">
        <p className="builder-status">Pinned values are copied only when this view creates a new item. They never change the filter or existing items.</p>
        {Object.entries(editing.creationDefaults ?? {}).map(([path, value]) => <div className="creation-default-row" key={path}>
          <Field label="Property"><Select value={path} onChange={(event) => replaceCreationDefaultPath(path, event.target.value)}>{[...new Set(creationDefaultFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup key={group} label={group}>{creationDefaultFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option key={field.path} value={field.path} disabled={field.path !== path && Object.hasOwn(editing.creationDefaults ?? {}, field.path)}>{field.label}</option>)}</optgroup>)}</Select></Field>
          <Field label="Value">{creationDefaultControl(path, value)}</Field>
          <IconButton size="compact" variant="ghost" className="creation-default-remove" aria-label={`Remove default ${viewFieldLabel(workspace, path)}`} onClick={() => { const next = { ...editing.creationDefaults }; delete next[path]; updateCreationDefaults(next); }}><CloseIcon /></IconButton>
        </div>)}
        <div className="builder-actions"><Select aria-label="Property to pin for new items" value={defaultField} onChange={(event) => setDefaultField(event.target.value)}>{[...new Set(creationDefaultFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup key={group} label={group}>{creationDefaultFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option key={field.path} value={field.path} disabled={Object.hasOwn(editing.creationDefaults ?? {}, field.path)}>{field.label}</option>)}</optgroup>)}</Select><Button size="compact" disabled={Object.hasOwn(editing.creationDefaults ?? {}, defaultField)} onClick={addCreationDefault}>+ Pin property</Button></div>
        <small className="field-hint">Relations, subtasks, item IDs, timestamps, completion history and occurrence identity cannot be copied into new items.</small>
      </fieldset></ViewEditorSection>
      {editing.renderer === 'board' && <ViewEditorSection sectionKey="board-columns" title="Board columns"><fieldset className="query-builder board-builder"><p className="builder-status">Group items by status or by tag. Empty columns are hidden by default.</p><Field label="Group columns by"><Select value={boardSettingsFor(editing).groupBy} onChange={(event) => updateBoardSettings({ groupBy: event.target.value as BoardSettings['groupBy'] })}><option value="status">Status</option><option value="tag">Tags</option></Select></Field><Checkbox checked={boardSettingsFor(editing).showEmpty} onChange={(event) => updateBoardSettings({ showEmpty: event.target.checked })} label="Show empty columns" />{boardSettingsFor(editing).groupBy === 'status' ? <><div className="board-column-settings" ref={boardReorder.container}>{boardStates.map((state, index) => <div key={state} {...boardReorder.rowProps(index)}>{boardReorder.handle(index, stateNames[state])}<Checkbox checked onChange={() => updateBoardSettings({ states: boardStates.filter((entry) => entry !== state) })} label={stateNames[state]} /></div>)}</div><div className="builder-actions">{defaultBoardStates.filter((state) => !boardStates.includes(state)).map((state) => <Button size="compact" key={state} onClick={() => updateBoardSettings({ states: [...boardStates, state] })}>+ {stateNames[state]}</Button>)}</div></> : <p className="builder-status">Each existing tag becomes a column automatically. Items without tags appear in “No tags”. Add or remove tags on items to change the columns.</p>}</fieldset></ViewEditorSection>}
      <ViewSortingEditor workspace={workspace} rules={sortRules} source={sortSource} onRules={updateSortRules} onSource={(source, parsed) => { setSortSource(source); if (parsed) setSortRules(parsed); }} />
      <ViewPortabilityEditor view={editing} rules={sortRules} sortSource={sortSource} json={viewJson} onJson={setViewJson} onApplyJson={() => applyViewJson()} onImport={(file) => void importViewTemplate(file)} onExport={onExportView} />
      {error && <p className="error">{error}</p>}
    </ResponsiveDialog>}
  </section>;
}
