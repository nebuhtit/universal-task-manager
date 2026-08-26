import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  compileSort, createId, migrateView, parseExpression, parsePortablePackage, parseSortSource, serializeSortRules, validateViewCreationDefaults,
  type ProjectedOccurrence, type SavedView, type UniversalItem, type ViewSortRule, type WorkspaceDocument,
} from '@utm/core';
import { CodeEditor } from '../../components/ui/CodeEditor';
import { CloseIcon } from '../../components/ui/icons';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Checkbox, Field, IconButton, Input, Select, Textarea } from '../../components/ui/primitives';
import { SectionGuide } from '../../components/ui/SectionGuide';
import { dateInput, fromDateInput } from '../../utils/dates';
import { stateNames } from '../items';
import { SavedViewSection } from './SavedViewSection';
import { boardSettingsFor, defaultBoardStates, type BoardSettings } from './viewSelectors';
import { exampleViewFieldValue, viewFieldGroups, viewFieldLabel, viewFieldOptions } from './fieldCatalog';
import { creationDefaultFieldOptions, defaultValueForPath } from './creationDefaults';
import { parseVisualRows, serializeVisualRows, toSqlExpression, visualFieldKinds, visualOperators, visualOptions, type VisualConditionRow } from './visualFilterModel';
import { DisplayedFieldsEditor } from './DisplayedFieldsEditor';
import { ViewSortingEditor } from './ViewSortingEditor';
import { ViewPortabilityEditor } from './ViewPortabilityEditor';
import { ViewEditorSection } from './ViewEditorSection';
import './views-editor.css';

type PortableFormat = 'json' | 'csv' | 'xlsx' | 'ics';
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

const viewAccentOptions = [
  { value: '#d9485f', label: 'Coral' }, { value: '#c27a00', label: 'Amber' }, { value: '#087f73', label: 'Teal' },
  { value: '#2864c7', label: 'Blue' }, { value: '#7048b8', label: 'Violet' }, { value: '#b83280', label: 'Berry' },
] as const;

export function ViewsPage({ workspace, commit, onEditItem, onState, onOpenCalendar, onAddItem, onExportView, celebratingIds, createRequest = 0 }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void;
  onOpenCalendar?: (viewId: string) => void; onAddItem: (view: SavedView) => void; onExportView: (view: SavedView, mode: 'definition' | 'results' | 'bundle', format?: PortableFormat, metadata?: boolean) => void; celebratingIds?: ReadonlySet<string> | undefined; createRequest?: number;
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
  const handledCreateRequest = useRef(createRequest);

  const syncRowsToDsl = (rows: VisualConditionRow[]) => {
    if (!editing) return;
    setVisualRows(rows);
    setVisualDirty(false);
    setEditing({ ...editing, query: { source: serializeVisualRows(rows) } });
  };
  const beginEditing = (view: SavedView) => {
    const copy = clean(view);
    copy.fields ??= [];
    copy.sort ??= [];
    const source = copy.sortSource ?? serializeSortRules(copy.sort.map((sort) => ({ expression: sort.field, direction: sort.direction, nulls: sort.nulls ?? 'last' })));
    const rows = parseVisualRows(copy.query.source);
    setEditing(copy);
    setVisualRows(rows ?? []);
    setVisualDirty(rows === null);
    setSortSource(source);
    try { setSortRules(parseSortSource(source)); } catch { setSortRules([]); }
    setDefaultField('priority');
    setConfirmDelete(false);
    setViewJson(JSON.stringify(copy, null, 2));
    setError('');
  };
  const addVisualRow = (join: 'and' | 'or') => syncRowsToDsl([...visualRows, { id: createId(), join, field: 'state', operator: '==', value: 'open' }]);
  const startVisualRows = () => syncRowsToDsl([{ id: createId(), join: 'and', field: 'state', operator: '==', value: 'open' }]);
  const updateVisualRow = (id: string, patch: Partial<VisualConditionRow>) => {
    const rows = visualRows.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (patch.field) {
        const options = visualOperators(patch.field);
        next.operator = options.includes(next.operator) ? next.operator : options[0]!;
        next.value = visualOptions[patch.field]?.[0] ?? '';
      }
      return next;
    });
    syncRowsToDsl(rows);
  };
  const updateSortRules = (next: ViewSortRule[]) => {
    setSortRules(next);
    setSortSource(serializeSortRules(next));
  };
  const updateSortRule = (index: number, patch: Partial<ViewSortRule>) => updateSortRules(sortRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  const moveSortRule = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= sortRules.length) return;
    const next = [...sortRules];
    [next[index], next[target]] = [next[target]!, next[index]!];
    updateSortRules(next);
  };
  const updateBoardSettings = (patch: Partial<BoardSettings>) => {
    if (!editing) return;
    const current = boardSettingsFor(editing);
    setEditing({ ...editing, extensions: { ...editing.extensions, 'utm:board': { ...current, ...patch } } });
  };
  const moveBoardState = (index: number, offset: number) => {
    if (!editing) return;
    const settings = boardSettingsFor(editing); const target = index + offset;
    if (target < 0 || target >= settings.states.length) return;
    const states = [...settings.states]; [states[index], states[target]] = [states[target]!, states[index]!]; updateBoardSettings({ states });
  };
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
    const next = { ...editing.creationDefaults }; const value = next[oldPath]; delete next[oldPath];
    if (!(path in next)) next[path] = value ?? defaultValueForPath(workspace, path);
    updateCreationDefaults(next);
  };
  const setCreationDefaultValue = (path: string, value: unknown) => updateCreationDefaults({ ...(editing?.creationDefaults ?? {}), [path]: value });
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
    if (path === 'tags' || path === 'contexts' || custom?.kind === 'multi_enum') return <Input value={Array.isArray(value) ? value.join(', ') : ''} placeholder="Comma-separated values" onChange={(event) => setCreationDefaultValue(path, commaList(event.target.value))} />;
    if (['priority', 'progress.current', 'progress.target', 'habit.target'].includes(path) || custom?.kind === 'number') return <Input type="number" value={Number(value)} onChange={(event) => setCreationDefaultValue(path, Number(event.target.value))} />;
    if (path.startsWith('schedule.') && (path.endsWith('At') || path === 'schedule.availableFrom')) return <Input type="datetime-local" value={dateInput(String(value))} onChange={(event) => setCreationDefaultValue(path, fromDateInput(event.target.value))} />;
    return <Input value={String(value ?? '')} onChange={(event) => setCreationDefaultValue(path, event.target.value)} />;
  };
  const save = () => {
    if (!editing) return;
    const result = editing;
    try {
      parseExpression(result.query.source.trim() || 'true');
      const defaultsValidation = validateViewCreationDefaults(result.creationDefaults);
      if (!defaultsValidation.valid) throw new Error(defaultsValidation.errors.join('; '));
      const parsedSort = parseSortSource(sortSource);
      compileSort(sortSource);
      const saved = { ...result, sortSource: serializeSortRules(parsedSort), sort: parsedSort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })) };
      commit('Save view', (draft) => { draft.views[result.id] = clean(saved); });
      setEditing(null);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const newView = () => beginEditing({ id: createId(), name: 'New view', query: { source: '(state == "open" || state == "done") && role != "series_template" && isTemplate != true' }, renderer: 'table', sort: [{ field: 'updatedAt', direction: 'desc' }], fields: ['title', 'state'] });
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

  return <section className="page-section views-page">
    <div className="views-stack">{Object.values(workspace.views).map((view) => <div key={view.id}>{view.renderer === 'calendar' && onOpenCalendar && <button className="open-calendar-button" onClick={() => onOpenCalendar(view.id)}>Open {view.name} in Calendar</button>}<SavedViewSection view={view} workspace={workspace} onEditView={() => beginEditing(view)} onEditItem={onEditItem} onState={onState} onAddItem={onAddItem} celebratingIds={celebratingIds} showTechnicalSummary={false} onRendererChange={(renderer) => commit('Change view renderer', (draft) => { const target = draft.views[view.id]; if (target) target.renderer = renderer; })} /></div>)}</div>
    {editing && <ResponsiveDialog
      open
      onOpenChange={(open) => { if (!open) setEditing(null); }}
      title="Edit view"
      description="Saved view"
      className="view-editor"
      closeLabel="Close view editor"
      initialFocus={false}
      footer={<><Button variant="destructive" onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } commit('Delete view', (draft) => { delete draft.views[editing.id]; Object.values(draft.dashboards).forEach((dashboard) => { for (let index = dashboard.widgets.length - 1; index >= 0; index -= 1) if (dashboard.widgets[index]?.viewId === editing.id) dashboard.widgets.splice(index, 1); }); }); setEditing(null); setConfirmDelete(false); }}>{confirmDelete ? 'Confirm delete' : 'Delete view'}</Button><span className="view-editor-action-spacer" /><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save}>Save view</Button></>}
    >
      <Field label="Name"><Input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field>
      <Field label="Renderer"><Select value={editing.renderer} onChange={(event) => setEditing({ ...editing, renderer: event.target.value as SavedView['renderer'] })}><option>list</option><option>table</option><option>calendar</option><option>board</option></Select></Field>
      <ViewEditorSection sectionKey="color" title="View color"><fieldset className="view-accent-picker"><p className="builder-status">This color identifies the view and completed ticks. Each option stays readable in light and dark themes.</p><div className="view-accent-options"><Button size="compact" className={!editing.accent ? 'selected' : ''} onClick={() => { const { accent: _accent, ...withoutAccent } = editing; setEditing(withoutAccent); }}>Default</Button>{viewAccentOptions.map((option) => <Button size="compact" key={option.value} className={editing.accent === option.value ? 'selected' : ''} aria-label={`${option.label} view color`} aria-pressed={editing.accent === option.value} onClick={() => setEditing({ ...editing, accent: option.value })}><span style={{ backgroundColor: option.value }} />{option.label}</Button>)}</div></fieldset></ViewEditorSection>
      <SectionGuide title="How views work"><ul><li>A view is a saved, live list; it never copies items.</li><li>Use the visual setup below: first choose which items appear, then choose what is shown for each item.</li><li>The optional advanced filter code below is synchronized with ordinary rows whenever its logic can be represented visually.</li><li>An empty filter means all items except recurring source templates. Sorting only controls order.</li></ul></SectionGuide>
      <ViewEditorSection sectionKey="visual-setup" title="Visual setup"><fieldset className="query-builder visual-query-builder">
        <h3 className="query-builder-heading">1. Filter items</h3>
        <p className="builder-status">Build the filter with ordinary fields, operators and values. The result and advanced code update immediately. Active range uses Event opens through Due.</p>
        {visualRows.map((row, index) => <div className="visual-condition-row" key={row.id}>
          <Field className="condition-join" label={index === 0 ? 'Where' : 'Join'}>{index === 0 ? <span className="field-hint">First rule</span> : <Select value={row.join} onChange={(event) => updateVisualRow(row.id, { join: event.target.value as 'and' | 'or' })}><option value="and">AND</option><option value="or">OR</option></Select>}</Field>
          <Field label="Property"><Select value={row.field} onChange={(event) => updateVisualRow(row.id, { field: event.target.value })}>{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup label={group} key={group}>{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option value={field.path} key={field.path}>{field.label}</option>)}</optgroup>)}</Select></Field>
          <Field label="Operator"><Select value={row.operator} onChange={(event) => updateVisualRow(row.id, { operator: event.target.value })}>{visualOperators(row.field).map((operator) => <option key={operator} value={operator}>{operator}</option>)}</Select></Field>
          <Field label="Value">{row.operator === 'is set' || row.operator === 'is not set' ? <span className="field-hint">No value needed</span> : visualOptions[row.field] ? <Select value={row.value} onChange={(event) => updateVisualRow(row.id, { value: event.target.value })}>{visualOptions[row.field]!.map((value) => <option key={value} value={value}>{row.field === 'state' ? stateNames[value as UniversalItem['state']] ?? value : value}</option>)}</Select> : <Input type={row.field.startsWith('schedule.') ? 'datetime-local' : 'text'} list={row.field === 'title' ? 'view-title-values' : row.field === 'tags' || row.field === 'contexts' ? 'view-tag-values' : undefined} placeholder={row.field === 'tags' || row.field === 'contexts' ? 'Choose or type comma-separated values' : undefined} value={row.value} onChange={(event) => updateVisualRow(row.id, { value: event.target.value })} />}</Field>
          <IconButton size="compact" variant="ghost" className="visual-condition-remove" aria-label={`Remove filter rule ${index + 1}`} onClick={() => syncRowsToDsl(visualRows.filter((entry) => entry.id !== row.id))}><CloseIcon /></IconButton>
        </div>)}
        <datalist id="view-title-values">{[...new Set(Object.values(workspace.items).map((entry) => entry.title))].map((title) => <option value={title} key={title} />)}</datalist>
        <datalist id="view-tag-values">{[...new Set(Object.values(workspace.items).flatMap((entry) => [...entry.tags, ...entry.contexts]))].sort().map((tag) => <option value={tag} key={tag} />)}</datalist>
        {visualDirty ? <p className="builder-status">This filter uses advanced code that cannot be shown as ordinary rows. Adding a visual rule replaces that code.</p> : <p className="builder-status">The visual rows and advanced filter code are synchronized.</p>}
        <div className="builder-actions"><Button size="compact" onClick={() => visualDirty ? startVisualRows() : addVisualRow('and')}>+ Add AND rule</Button><Button size="compact" onClick={() => visualDirty ? startVisualRows() : addVisualRow('or')}>+ Add OR rule</Button></div>
        <DisplayedFieldsEditor workspace={workspace} view={editing} onChange={setEditing} />
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
      <ViewEditorSection sectionKey="task-list" title="Task list"><Field label="Task list" hint="Choose an existing list or type a new name. Items assigned to it will appear in this view."><Input value={editing.list ?? ''} list="view-list-values" placeholder="Choose or type a list name" onChange={(event) => { const list = event.target.value.trim(); setEditing(list ? { ...editing, list } : (() => { const { list: _list, ...withoutList } = editing; return withoutList; })()); }} /><datalist id="view-list-values">{[...new Set(Object.values(workspace.items).map((item) => item.list).filter((list): list is string => Boolean(list)))].sort().map((list) => <option value={list} key={list} />)}</datalist></Field></ViewEditorSection>
      {editing.renderer === 'board' && <ViewEditorSection sectionKey="board-columns" title="Board columns"><fieldset className="query-builder board-builder"><p className="builder-status">Group items by status or by tag. Empty columns are hidden by default.</p><Field label="Group columns by"><Select value={boardSettingsFor(editing).groupBy} onChange={(event) => updateBoardSettings({ groupBy: event.target.value as BoardSettings['groupBy'] })}><option value="status">Status</option><option value="tag">Tags</option></Select></Field><Checkbox checked={boardSettingsFor(editing).showEmpty} onChange={(event) => updateBoardSettings({ showEmpty: event.target.checked })} label="Show empty columns" />{boardSettingsFor(editing).groupBy === 'status' ? <><div className="board-column-settings">{boardSettingsFor(editing).states.map((state, index) => <div key={state}><Checkbox checked onChange={() => updateBoardSettings({ states: boardSettingsFor(editing).states.filter((entry) => entry !== state) })} label={stateNames[state]} /><div><IconButton size="compact" variant="ghost" aria-label={`Move ${stateNames[state]} left`} disabled={index === 0} onClick={() => moveBoardState(index, -1)}>←</IconButton><IconButton size="compact" variant="ghost" aria-label={`Move ${stateNames[state]} right`} disabled={index === boardSettingsFor(editing).states.length - 1} onClick={() => moveBoardState(index, 1)}>→</IconButton></div></div>)}</div><div className="builder-actions">{defaultBoardStates.filter((state) => !boardSettingsFor(editing).states.includes(state)).map((state) => <Button size="compact" key={state} onClick={() => updateBoardSettings({ states: [...boardSettingsFor(editing).states, state] })}>+ {stateNames[state]}</Button>)}</div></> : <p className="builder-status">Each existing tag becomes a column automatically. Items without tags appear in “No tags”. Add or remove tags on items to change the columns.</p>}</fieldset></ViewEditorSection>}
      <ViewSortingEditor workspace={workspace} rules={sortRules} source={sortSource} onRules={updateSortRules} onSource={(source, parsed) => { setSortSource(source); if (parsed) setSortRules(parsed); }} />
      <ViewPortabilityEditor view={editing} rules={sortRules} sortSource={sortSource} json={viewJson} onJson={setViewJson} onApplyJson={() => applyViewJson()} onImport={(file) => void importViewTemplate(file)} onExport={onExportView} />
      {error && <p className="error">{error}</p>}
    </ResponsiveDialog>}
  </section>;
}
