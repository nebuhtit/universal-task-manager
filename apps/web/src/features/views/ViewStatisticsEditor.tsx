import { effectiveItemDurationMs, inferViewPeriod, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { SearchableDisclosureList } from '../../components/ui/SearchableDisclosureList';
import { Checkbox } from '../../components/ui/primitives';
import { ViewEditorSection } from './ViewEditorSection';
import { itemIsExcludedByRows, itemIsExcludedBySource, setItemExcludedInRows, setItemExcludedInSource } from './viewItemExclusions';
import type { VisualConditionRow } from './visualFilterModel';
import './views-editor.css';

export function ViewStatisticsEditor({ workspace, view, rows, visualDirty, onViewChange, onRowsChange, fixedPeriodLabel, now = new Date() }: {
  workspace: WorkspaceDocument;
  view: SavedView;
  rows: VisualConditionRow[];
  visualDirty: boolean;
  onViewChange: (view: SavedView) => void;
  onRowsChange: (rows: VisualConditionRow[]) => void;
  fixedPeriodLabel?: string;
  now?: Date;
}) {
  const statistics = view.statistics ?? { showTime: true, reservedItemIds: [] };
  const period = fixedPeriodLabel === undefined
    ? inferViewPeriod(view, now, { timeZone: workspace.calendarPreferences.timezone, weekStartsOn: workspace.calendarPreferences.weekStartsOn })
    : null;
  const candidates = Object.values(workspace.items)
    .filter((item) => !item.deletedAt && item.role !== 'occurrence' && Boolean(item.schedule) && effectiveItemDurationMs(item) > 0)
    .sort((left, right) => left.title.localeCompare(right.title));
  const excluded = (item: UniversalItem) => visualDirty ? itemIsExcludedBySource(item, view.query.source) : itemIsExcludedByRows(item, rows);
  const updateStatistics = (showTime: boolean, reservedItemIds = statistics.reservedItemIds) => onViewChange({
    ...view,
    statistics: { showTime, reservedItemIds: [...new Set(reservedItemIds)] },
  });
  const toggleExcluded = (item: UniversalItem, checked: boolean) => {
    if (visualDirty) onViewChange({ ...view, query: { source: setItemExcludedInSource(item, view.query.source, checked) } });
    else onRowsChange(setItemExcludedInRows(item, rows, checked));
  };

  return <ViewEditorSection sectionKey={`statistics:${view.id}`} title="Statistics"><fieldset className="view-statistics-settings">
    <Checkbox checked={statistics.showTime} onChange={(event) => updateStatistics(event.target.checked)} label="Show time statistics" />
    <p className="builder-status">Completion is weighted by Duration. Remaining time includes unfinished items in this view.</p>
    {fixedPeriodLabel ? <p className="view-statistics-period">Capacity period: <strong>{fixedPeriodLabel}</strong></p>
      : period ? <p className="view-statistics-period">Capacity period: <strong>{period.startDate === period.endDate ? period.startDate : `${period.startDate} – ${period.endDate}`}</strong></p>
        : <p className="view-statistics-period">Free time unavailable: add one finite Schedule in period rule.</p>}
    <p className="builder-status">Free time is the whole period minus this view's planned Duration and the reserved items below.</p>
    <SearchableDisclosureList uiKey={`view-editor:statistics-reserved:${view.id}`} className="view-statistics-reserved" summary={<span className="view-statistics-reserved-summary"><span>Reserved items</span><small>{statistics.reservedItemIds.length} reserved · {candidates.filter(excluded).length} excluded</small></span>} items={candidates} getSearchText={(item) => item.title} searchLabel="Search reserved items" searchPlaceholder="Search items" emptyText="No scheduled items with Duration yet." noMatchesText="No matching items." renderItem={(item) => <div className="view-statistics-item-controls" key={item.id}><span className="view-statistics-item-title">{item.title}{item.role === 'series_template' && <small> · repeats</small>}</span><Checkbox checked={statistics.reservedItemIds.includes(item.id)} onChange={(event) => updateStatistics(statistics.showTime, event.target.checked ? [...statistics.reservedItemIds, item.id] : statistics.reservedItemIds.filter((id) => id !== item.id))} label="Reserve time" /><Checkbox checked={excluded(item)} onChange={(event) => toggleExcluded(item, event.target.checked)} label="Exclude from View" /></div>} />
    <small className="field-hint">Reserve time affects statistics only. Exclude from View adds a visible AND rule to Filter items and Advanced filter code. The two choices are independent.</small>
    <small className="field-hint">A recurring item is counted once for every occurrence inside the view period. If its occurrence is already in the view, it is not subtracted twice.</small>
  </fieldset></ViewEditorSection>;
}
