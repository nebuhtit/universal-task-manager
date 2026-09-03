import { useLayoutEffect, useRef, useState } from 'react';
import { ACTIVE_ITEM_VIEW_QUERY, calculateItemSetMetrics, type SavedView, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { PersistedDetails, persistUiBoolean, readUiBoolean } from '../../components/ui/PersistedDetails';
import { Button, Checkbox, Disclosure, Surface } from '../../components/ui/primitives';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { formatSystemDateTime } from '../../utils/dates';
import { ViewMetricsSummary } from '../views/ViewMetricsSummary';
import { useWorkspaceBoundaryNow } from '../views/useViewEvaluation';
import { getWorkspaceIndex } from '../../services/workspaceIndex';
import { ItemCard } from './ItemCard';
import { FieldIcon } from './FieldIcon';
import { isHabitOccurrence, isItemTemplate, stateNames, viewFieldOptions } from './fieldDisplay';
import { UserDataText } from '../../i18n-react';
import { longListClass } from '../../performance/longList';
import './all-items-settings.css';

export const ALL_ITEMS_VIEW_ID = '__all_items__';

export const allItemsViewFor = (workspace: WorkspaceDocument): SavedView => workspace.views[ALL_ITEMS_VIEW_ID] ?? {
  id: ALL_ITEMS_VIEW_ID, name: 'All items', query: { source: ACTIVE_ITEM_VIEW_QUERY }, renderer: 'list', sort: [{ field: 'updatedAt', direction: 'desc' }], fields: [],
};

function DeletedItemsList({ items, onRestore, onClear, onDelete }: { items: UniversalItem[]; onRestore: (item: UniversalItem) => void; onClear: () => void; onDelete: (item: UniversalItem) => void }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const sorted = [...items].sort((left, right) => new Date(right.deletedAt!).getTime() - new Date(left.deletedAt!).getTime());
  return <details className="trash-section" open={sorted.length > 0}>
    <summary><span>Trash</span><b>{sorted.length}</b>{sorted.length > 0 && <button type="button" className="secondary compact-action trash-clear" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setConfirmClear(true); }}>Clear trash</button>}</summary>
    <p className="section-help">Deleted items stay here until you restore them.</p>
    {confirmClear && sorted.length > 0 && <div className="trash-confirm" role="alert"><strong>Permanently delete {sorted.length} {sorted.length === 1 ? 'item' : 'items'}?</strong><span>This cannot be undone.</span><div><button type="button" className="secondary compact-action" onClick={() => setConfirmClear(false)}>Cancel</button><button type="button" className="danger compact-action" onClick={() => { onClear(); setConfirmClear(false); }}>Delete permanently</button></div></div>}
    <div className="trash-list">{sorted.length ? sorted.map((item) => <article className="trash-item" key={item.id}>
      <div><UserDataText className="trash-title">{item.title || 'Untitled'}</UserDataText><span className="item-meta"><span className={`preset ${item.preset}`}>{item.preset}</span><span>{stateNames[item.state]}</span><span>Deleted {formatSystemDateTime(item.deletedAt!)}</span></span></div>
      <div className="trash-item-actions">{confirmDeleteId === item.id ? <><button type="button" className="secondary compact-action" onClick={() => setConfirmDeleteId(null)}>Cancel</button><button type="button" className="danger compact-action" onClick={() => { onDelete(item); setConfirmDeleteId(null); }}>Delete permanently</button></> : <><button type="button" className="secondary compact-action" aria-label={`Restore ${item.title || 'Untitled'}`} onClick={() => onRestore(item)}>Restore</button><button type="button" className="secondary compact-action" aria-label={`Delete ${item.title || 'Untitled'} permanently`} onClick={() => setConfirmDeleteId(item.id)}>Delete</button></>}</div>
    </article>) : <p className="empty">Trash is empty.</p>}</div>
  </details>;
}

function AllItemsSettings({ open, workspace, view, onSave, onClose }: { open: boolean; workspace: WorkspaceDocument; view: SavedView; onSave: (view: SavedView) => void; onClose: () => void }) {
  const [fields, setFields] = useState(view.fields ?? []);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) setFields(view.fields ?? []);
    wasOpen.current = open;
  }, [open, view.fields]);
  const toggle = (path: string) => setFields((current) => current.includes(path) ? current.filter((entry) => entry !== path) : [...current, path]);
  const options = viewFieldOptions(workspace);
  return <ResponsiveDialog
    open={open}
    onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}
    title="Customize all items"
    description="Choose the item properties shown in All items. Status sections and Trash keep their current layout."
    closeLabel="Close all items settings"
    className="all-items-settings"
    footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { onSave({ ...view, fields }); onClose(); }}>Save fields</Button></>}
  >
    <Surface variant="muted" className="all-items-settings-note">This uses the same SavedView field model as every other view.</Surface>
    <div className="all-items-field-groups">{[...new Set(options.map((field) => field.group))].map((group) => <Disclosure key={group} uiKey={`all:settings:${group}`} summary={group} defaultOpen>
      <div className="all-items-field-options">{options.filter((field) => field.group === group).map((field) => <Checkbox
        key={field.path}
        checked={fields.includes(field.path)}
        onChange={() => toggle(field.path)}
        label={<span className="all-items-field-label"><span><FieldIcon path={field.path} label={field.label} />{field.label}</span><small>{field.path}</small></span>}
      />)}</div>
    </Disclosure>)}</div>
  </ResponsiveDialog>;
}

function AllItemsCollections({ items, fields, workspace, now, onEdit, onState }: { items: UniversalItem[]; fields: string[]; workspace: WorkspaceDocument; now: Date; onEdit: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void }) {
  const collections = [
    { name: 'Overdue', help: 'Open items whose deadline has passed.', items: items.filter((item) => item.state === 'open' && item.schedule?.dueAt && new Date(item.schedule.dueAt).getTime() < now.getTime()) },
    { name: 'Unscheduled', help: 'Open items without a scheduled time or deadline.', items: items.filter((item) => item.state === 'open' && !item.schedule?.startAt && !item.schedule?.dueAt) },
    { name: 'With reminders', help: 'Items that still have at least one active reminder.', items: items.filter((item) => item.reminders.some((reminder) => !reminder.acknowledgedAt)) },
  ];
  return <PersistedDetails uiKey="all:planning" defaultOpen={false} className="all-item-collections">
    <summary><span>Planning &amp; attention</span><b>{collections.reduce((total, collection) => total + collection.items.length, 0)}</b></summary>
    <p className="section-help">Useful system collections. An item can appear here and in its status section; custom categories will come later through Views.</p>
    {collections.map((collection) => <PersistedDetails key={collection.name} uiKey={`all:collection:${collection.name}`} defaultOpen={collection.name === 'Overdue' && collection.items.length > 0}>
      <summary><span>{collection.name}</span><b>{collection.items.length}</b></summary>
      <p className="section-help">{collection.help}</p>
      <div className={longListClass('item-list', collection.items.length)}>{collection.items.length ? collection.items.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} now={now} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />) : <p className="empty">None.</p>}</div>
    </PersistedDetails>)}
  </PersistedDetails>;
}

export function AllItemsPage({ workspace, view, onEdit, onState, onSaveView, onRestore, onClearTrash, onDelete }: {
  workspace: WorkspaceDocument;
  view: SavedView;
  onEdit: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void;
  onSaveView: (view: SavedView) => void;
  onRestore: (item: UniversalItem) => void;
  onClearTrash: () => void;
  onDelete: (item: UniversalItem) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const now = useWorkspaceBoundaryNow(workspace);
  const workspaceIndex = getWorkspaceIndex(workspace);
  const recurringItems = workspaceIndex.recurrence.seriesTemplates.filter((item) => !item.habit && !isItemTemplate(item));
  const templateItems = workspaceIndex.visibleItems.filter(isItemTemplate);
  const deletedItems = workspaceIndex.items.filter((item) => Boolean(item.deletedAt));
  const fields = view.fields ?? ['title', 'state'];
  const visibleItems = workspaceIndex.visibleItems.filter((item) => !isItemTemplate(item) && !isHabitOccurrence(workspace, item));
  const metrics = calculateItemSetMetrics(visibleItems);
  return <section className="page-section">
    <header className="all-items-toolbar"><div><p className="eyebrow">EVERYTHING</p><h1>All items</h1><ViewMetricsSummary metrics={metrics} language={workspace.calendarPreferences.language} /></div><Button onClick={() => setSettingsOpen(true)}>Customize</Button></header>
    <div className="all-sections">
      {(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => { const items = workspaceIndex.visibleItems.filter((item) => item.state === state && !isItemTemplate(item) && (item.role !== 'series_template' || Boolean(item.habit)) && !isHabitOccurrence(workspace, item)); const uiKey = `all:${state}`; return <details key={state} open={readUiBoolean(uiKey, state === 'open' || state === 'auto_closed')} onToggle={(event) => persistUiBoolean(uiKey, event.currentTarget.open)}><summary><span>{stateNames[state]}</span><b>{items.length}</b></summary><div className={longListClass('item-list', items.length)}>{items.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} now={now} onEdit={() => onEdit(item)} onState={(nextState) => onState(item, nextState)} />)}</div></details>; })}
      <details open={readUiBoolean('all:templates', templateItems.length > 0)} onToggle={(event) => persistUiBoolean('all:templates', event.currentTarget.open)} className="recurring-items"><summary><span>Templates</span><b>{templateItems.length}</b></summary><div className={longListClass('item-list', templateItems.length)}>{templateItems.length ? templateItems.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} now={now} onEdit={() => onEdit(item)} onState={(nextState) => onState(item, nextState)} />) : <p className="empty">No templates yet.</p>}</div></details>
      <details open={readUiBoolean('all:recurring', recurringItems.length > 0)} onToggle={(event) => persistUiBoolean('all:recurring', event.currentTarget.open)} className="recurring-items"><summary><span>Recurring items</span><b>{recurringItems.length}</b></summary><p className="section-help">These are the recurrence source settings. Auto-renew keeps one live item and records finished cycles inside its Cycle history.</p><div className={longListClass('item-list', recurringItems.length)}>{recurringItems.length ? recurringItems.map((item) => <ItemCard key={item.id} item={item} fields={fields} workspace={workspace} now={now} onEdit={() => onEdit(item)} onState={(nextState) => onState(item, nextState)} />) : <p className="empty">No recurring items yet.</p>}</div></details>
    </div>
    <AllItemsCollections items={visibleItems} fields={fields} workspace={workspace} now={now} onEdit={onEdit} onState={onState} />
    <DeletedItemsList items={deletedItems} onRestore={onRestore} onClear={onClearTrash} onDelete={onDelete} />
    <AllItemsSettings open={settingsOpen} workspace={workspace} view={view} onClose={() => setSettingsOpen(false)} onSave={onSaveView} />
  </section>;
}
