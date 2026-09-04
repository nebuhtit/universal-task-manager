import { useEffect, useState } from 'react';
import {
  compileSort, createId, parseExpression, parseSortSource, serializeSortRules,
  type CalendarDayViewPreferences, type SavedView, type ViewSortRule, type WorkspaceDocument,
} from '@utm/core';
import { CodeEditor } from '../../components/ui/CodeEditor';
import { CloseIcon } from '../../components/ui/icons';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Field, IconButton, Input, Select } from '../../components/ui/primitives';
import { DisplayedFieldsEditor } from '../views/DisplayedFieldsEditor';
import { ReminderPeriodEditor, ScheduleSourcePicker } from '../views/SchedulePeriodEditor';
import { ViewEditorSection } from '../views/ViewEditorSection';
import { ViewStatisticsEditor } from '../views/ViewStatisticsEditor';
import { ViewSortingEditor } from '../views/ViewSortingEditor';
import { viewFieldOptions } from '../views/fieldCatalog';
import {
  defaultVisualConditionForField, isReminderVisualField, parseVisualRows, reminderPeriodField, serializeVisualRows, visualFieldKind, visualFilterFieldLabel, visualOperators, visualOptionsForField,
  type VisualConditionRow,
} from '../views/visualFilterModel';

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const editorView = (settings: CalendarDayViewPreferences): SavedView => ({
  id: '__calendar_day__', name: 'Calendar day', renderer: 'list',
  query: clean(settings.filter), fields: [...settings.fields],
  sort: settings.sort.map((rule) => ({ field: rule.expression, direction: rule.direction, nulls: rule.nulls })),
  sortSource: settings.sortSource ?? serializeSortRules(settings.sort),
  statistics: settings.statistics ?? { showTime: true, reservedItemIds: [] },
});

export function CalendarDayViewEditor({ open, workspace, onOpenChange, onSave }: {
  open: boolean;
  workspace: WorkspaceDocument;
  onOpenChange: (open: boolean) => void;
  onSave: (settings: CalendarDayViewPreferences) => void;
}) {
  const [draft, setDraft] = useState(() => clean(workspace.calendarPreferences.dayView));
  const [rows, setRows] = useState<VisualConditionRow[]>([]);
  const [visualDirty, setVisualDirty] = useState(false);
  const [sortRules, setSortRules] = useState<ViewSortRule[]>([]);
  const [sortSource, setSortSource] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const next = clean(workspace.calendarPreferences.dayView);
    const parsed = parseVisualRows(next.filter.source, workspace.customFields);
    if (parsed) next.filter = { source: serializeVisualRows(parsed, workspace.customFields) };
    setDraft(next);
    setRows(parsed ?? []);
    setVisualDirty(parsed === null);
    const source = next.sortSource ?? serializeSortRules(next.sort);
    setSortSource(source);
    try { setSortRules(parseSortSource(source)); } catch { setSortRules([]); }
    setError('');
  }, [open, workspace.calendarPreferences.dayView]);

  const close = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onOpenChange(false);
  };
  const syncRows = (next: VisualConditionRow[]) => {
    setRows(next); setVisualDirty(false);
    setDraft((current) => ({ ...current, filter: { source: serializeVisualRows(next, workspace.customFields) } }));
  };
  const addRow = (join: 'and' | 'or') => syncRows([...(visualDirty ? [] : rows), { id: createId(), join, field: 'state', operator: '==', value: 'open' }]);
  const updateRow = (id: string, patch: Partial<VisualConditionRow>) => syncRows(rows.map((row) => {
    if (row.id !== id) return row;
    const next = { ...row, ...patch };
    if (patch.field) {
      Object.assign(next, defaultVisualConditionForField(patch.field, workspace.customFields));
    } else if (patch.operator && patch.operator !== 'is set' && patch.operator !== 'is not set' && !next.value) {
      next.value = visualOptionsForField(next.field, workspace.customFields)?.[0] ?? '';
    }
    return next;
  }));
  const updateSortRules = (next: ViewSortRule[]) => { setSortRules(next); setSortSource(serializeSortRules(next)); };
  const view = editorView(draft);
  const updateEditorView = (next: SavedView) => setDraft((current) => ({ ...current, filter: clean(next.query), fields: [...next.fields], statistics: next.statistics ?? { showTime: true, reservedItemIds: [] } }));
  const save = () => {
    try {
      parseExpression(draft.filter.source.trim() || 'true');
      compileSort(sortSource);
      const parsedSort = parseSortSource(sortSource);
      onSave({ ...clean(draft), filter: { source: draft.filter.source.trim() || 'true' }, sort: parsedSort, sortSource: serializeSortRules(parsedSort) });
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <ResponsiveDialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()} title="Edit calendar day view" closeLabel="Close calendar day view editor" className="view-editor calendar-day-view-editor" footer={<><span /><Button variant="ghost" onClick={close}>Cancel</Button><Button onClick={save}>Save view</Button></>}>
    <ViewEditorSection sectionKey="calendar-day-period" title="Selected day">
      <fieldset className="query-builder calendar-day-period-settings">
        <p className="builder-status">The period is always the selected calendar day. These conditions are joined with OR; the result is always joined to the filter below with AND.</p>
        <ScheduleSourcePicker day sources={draft.scheduleSources} onChange={(scheduleSources) => setDraft({ ...draft, scheduleSources })} />
      </fieldset>
    </ViewEditorSection>
    <ViewEditorSection sectionKey="calendar-day-filter" title="Filter items">
      <fieldset className="query-builder visual-query-builder">
        {rows.some((row) => isReminderVisualField(row.field)) && <p className="builder-status">Reminder filters: Any reminders includes acknowledged reminders; Has active reminders uses unacknowledged reminders; Next resolved active reminder ignores active reminders whose date cannot be calculated.</p>}
        {rows.map((row, index) => <div className="visual-condition-row" key={row.id}>
          <Field className="condition-join" label={index === 0 ? 'Where' : 'Join'}>{index === 0 ? <span className="field-hint">First rule</span> : <Select value={row.join} onChange={(event) => updateRow(row.id, { join: event.target.value as 'and' | 'or' })}><option value="and">AND</option><option value="or">OR</option></Select>}</Field>
          <Field label="Property"><Select value={row.field} onChange={(event) => updateRow(row.id, { field: event.target.value })}><optgroup label="Time periods"><option value={reminderPeriodField}>Next reminder relative to period</option></optgroup>{[...new Set(viewFieldOptions(workspace).map((field) => field.group))].map((group) => <optgroup label={group} key={group}>{viewFieldOptions(workspace).filter((field) => field.group === group).map((field) => <option value={field.path} key={field.path}>{visualFilterFieldLabel(field.path, field.label)}</option>)}</optgroup>)}</Select></Field>
          {row.field === reminderPeriodField ? <Field className="schedule-period-condition" label="Nearest active reminder"><ReminderPeriodEditor value={row.value} onChange={(value) => updateRow(row.id, { value })} /></Field> : <><Field label="Operator"><Select value={row.operator} onChange={(event) => updateRow(row.id, { operator: event.target.value })}>{visualOperators(row.field, workspace.customFields).map((operator) => <option key={operator}>{operator}</option>)}</Select></Field>
          <Field label="Value">{row.operator === 'is set' || row.operator === 'is not set' ? <span className="field-hint">No value needed</span> : visualOptionsForField(row.field, workspace.customFields) ? <Select value={row.value} onChange={(event) => updateRow(row.id, { value: event.target.value })}>{visualOptionsForField(row.field, workspace.customFields)!.map((value) => <option key={value}>{value}</option>)}</Select> : <Input type={visualFieldKind(row.field, workspace.customFields) === 'date' ? 'datetime-local' : visualFieldKind(row.field, workspace.customFields) === 'number' ? 'number' : 'text'} value={row.value} onChange={(event) => updateRow(row.id, { value: event.target.value })} />}</Field></>}
          <IconButton size="compact" variant="ghost" aria-label={`Remove filter rule ${index + 1}`} onClick={() => syncRows(rows.filter((candidate) => candidate.id !== row.id))}><CloseIcon /></IconButton>
        </div>)}
        <p className="builder-status">{visualDirty ? 'This filter uses advanced code. Edit it below or replace it with a visual rule.' : 'Visual rules and advanced filter code are synchronized.'}</p>
        <div className="builder-actions"><Button size="compact" onClick={() => addRow('and')}>+ Add AND rule</Button><Button size="compact" onClick={() => addRow('or')}>+ Add OR rule</Button></div>
        <Field label="Advanced filter code" hint="This additional filter cannot remove or bypass the selected-day boundary."><CodeEditor language="dsl" ariaLabel="Calendar day advanced filter code" rows={5} value={draft.filter.source} onChange={(source) => { const parsed = parseVisualRows(source, workspace.customFields); setDraft({ ...draft, filter: { source } }); setRows(parsed ?? []); setVisualDirty(parsed === null); }} /></Field>
      </fieldset>
    </ViewEditorSection>
    <ViewEditorSection sectionKey="calendar-day-fields" title="Show in results"><DisplayedFieldsEditor workspace={workspace} view={view} onChange={(next) => setDraft({ ...draft, fields: next.fields })} /></ViewEditorSection>
    <ViewStatisticsEditor workspace={workspace} view={view} rows={rows} visualDirty={visualDirty} onViewChange={updateEditorView} onRowsChange={syncRows} fixedPeriodLabel="Selected calendar day" />
    <ViewSortingEditor workspace={workspace} rules={sortRules} source={sortSource} onRules={updateSortRules} onSource={(source, parsed) => { setSortSource(source); if (parsed) setSortRules(parsed); }} />
    {error && <p className="error" role="alert">{error}</p>}
  </ResponsiveDialog>;
}
