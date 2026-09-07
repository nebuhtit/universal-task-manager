import { useEffect, useState } from 'react';
import {
  validateFilterProgram, compileSort, parseExpression, parseSortSource, serializeSortRules,
  type CalendarDayViewPreferences, type SavedView, type ViewSortRule, type WorkspaceDocument,
} from '@utm/core';
import { FilterProgramEditor } from '../views/FilterProgramEditor';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button } from '../../components/ui/primitives';
import { DisplayedFieldsEditor } from '../views/DisplayedFieldsEditor';
import { ScheduleSourcePicker } from '../views/SchedulePeriodEditor';
import { ViewEditorSection } from '../views/ViewEditorSection';
import { ViewStatisticsEditor } from '../views/ViewStatisticsEditor';
import { ViewSortingEditor } from '../views/ViewSortingEditor';
import {
  parseVisualRows, serializeVisualRows,
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
  const [filterValid, setFilterValid] = useState(true);

  useEffect(() => {
    if (!open) return;
    const next = clean(workspace.calendarPreferences.dayView);
    const parsed = parseVisualRows(next.filter.source, workspace.customFields);
    if (parsed) next.filter = { source: serializeVisualRows(parsed, workspace.customFields) };
    setFilterValid(true);
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
  const updateSortRules = (next: ViewSortRule[]) => { setSortRules(next); setSortSource(serializeSortRules(next)); };
  const view = editorView(draft);
  const updateEditorView = (next: SavedView) => setDraft((current) => ({ ...current, filter: clean(next.query), fields: [...next.fields], statistics: next.statistics ?? { showTime: true, reservedItemIds: [] } }));
  const save = () => {
    if (!filterValid) return;
    try {
      validateFilterProgram(parseExpression(draft.filter.source.trim() || 'true'));
      compileSort(sortSource);
      const parsedSort = parseSortSource(sortSource);
      onSave({ ...clean(draft), filter: { source: draft.filter.source.trim() || 'true' }, sort: parsedSort, sortSource: serializeSortRules(parsedSort) });
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <ResponsiveDialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()} title="Edit calendar day view" closeLabel="Close calendar day view editor" className="view-editor calendar-day-view-editor" footer={<><span /><Button variant="ghost" onClick={close}>Cancel</Button><Button disabled={!filterValid} onClick={save}>Save view</Button></>}>
    <ViewEditorSection sectionKey="calendar-day-period" title="Selected day">
      <fieldset className="query-builder calendar-day-period-settings">
        <p className="builder-status">The period is always the selected calendar day. These conditions are joined with OR; the result is always joined to the filter below with AND.</p>
        <ScheduleSourcePicker day sources={draft.scheduleSources} onChange={(scheduleSources) => setDraft({ ...draft, scheduleSources })} />
      </fieldset>
    </ViewEditorSection>
    <ViewEditorSection sectionKey="calendar-day-filter" title="Filter items"><FilterProgramEditor workspace={workspace} source={draft.filter.source} python={draft.filterPython} onValidityChange={setFilterValid} onChange={(source, python) => { const parsed = parseVisualRows(source, workspace.customFields); setRows(parsed ?? []); setVisualDirty(parsed === null); setDraft({ ...draft, filter: { source }, filterPython: python }); }} /></ViewEditorSection>
    <ViewEditorSection sectionKey="calendar-day-fields" title="Show in results"><DisplayedFieldsEditor workspace={workspace} view={view} onChange={(next) => setDraft({ ...draft, fields: next.fields })} /></ViewEditorSection>
    <ViewStatisticsEditor workspace={workspace} view={view} rows={rows} visualDirty={visualDirty} onViewChange={updateEditorView} onRowsChange={syncRows} fixedPeriodLabel="Selected calendar day" />
    <ViewSortingEditor workspace={workspace} rules={sortRules} source={sortSource} onRules={updateSortRules} onSource={(source, parsed) => { setSortSource(source); if (parsed) setSortRules(parsed); }} />
    {error && <p className="error" role="alert">{error}</p>}
  </ResponsiveDialog>;
}
