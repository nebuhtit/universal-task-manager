import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import * as Automerge from '@automerge/automerge';
import ReactMarkdown from 'react-markdown';
import {
  APP_NAME, APP_RELEASED_AT, APP_VERSION, backfillItemCreationVersions, collectScheduledEvents, compileQuery, createId, createItem, evaluateFormulas, makeSeries,
  parseExpression, reconcileRecurrences, runAutomationEvents,
  type AutomationAction, type AutomationRule, type CustomFieldDefinition, type DashboardWidget,
  type DomainEvent, type ItemPreset, type SavedView, type Schedule, type UniversalItem, type WorkspaceDocument,
  type ReconcileResult,
} from '@utm/core';
import {
  createLocalWorkspace, exportContainer, hasLocalWorkspace, importAsLocalWorkspace, lock,
  mergeIntoLocalWorkspace, saveLocalWorkspace, unlockLocalWorkspace,
  type UnlockedWorkspace,
} from '@utm/sdk';

type Page = 'home' | 'all' | 'views' | 'automations' | 'settings';
type Notice = { id: string; title: string; body: string; at: string };

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const dateInput = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromDateInput = (value: string) => value ? new Date(value).toISOString() : undefined;
const commaList = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);

async function reconcileOffMainThread(workspace: WorkspaceDocument, now: Date): Promise<ReconcileResult> {
  if (typeof Worker === 'undefined') return reconcileRecurrences(clean(workspace), now);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./recurrence.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('Recurrence worker timed out')); }, 20_000);
    worker.onmessage = (event: MessageEvent<{ ok: true; result: ReconcileResult } | { ok: false; error: string }>) => {
      window.clearTimeout(timeout); worker.terminate();
      if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error));
    };
    worker.onerror = () => { window.clearTimeout(timeout); worker.terminate(); reject(new Error('Recurrence worker failed')); };
    worker.postMessage({ workspace: clean(workspace), now: now.toISOString() });
  });
}

function Icon({ children }: { children: ReactNode }) { return <span className="icon" aria-hidden>{children}</span>; }
function CloseIcon() { return <svg className="close-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M4 4l12 12M16 4 4 16" /></svg>; }

type LineIconName = 'home' | 'items' | 'views' | 'rules' | 'settings' | 'lock' | 'bell' | 'transfer';
function LineIcon({ name }: { name: LineIconName }) {
  const paths: Record<LineIconName, ReactNode> = {
    home: <><path d="M3 10.8 12 3l9 7.8"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7"/></>,
    items: <><path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1 1 2-2M3 12h3M3 18h3"/></>,
    views: <><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="8" height="6" rx="1.5"/><rect x="15" y="14" width="6" height="6" rx="1.5"/></>,
    rules: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    transfer: <><path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="m18 7-3 3M6 17l3-3"/></>,
  };
  return <svg className="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}

function LockScreen({ exists, onReady }: { exists: boolean; onReady: (session: UnlockedWorkspace) => void }) {
  const [name, setName] = useState('My workspace');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (!exists && password !== confirm) throw new Error('Passwords do not match');
      onReady(exists ? await unlockLocalWorkspace(password) : await createLocalWorkspace(password, name));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const importWorkspace = async (file: File) => {
    setBusy(true); setError('');
    try { onReady(await importAsLocalWorkspace(await file.text(), password)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return <main className="lock-shell">
    <section className="lock-card">
      <div className="brand-mark">U</div>
      <p className="eyebrow">UNIVERSAL TASK MANAGER</p>
      <h1>{exists ? 'Unlock your workspace' : 'Build your own system'}</h1>
      <p className="muted">Your data stays on this device, encrypted. There is no account and no password recovery. Please remember your password.</p>
      <form onSubmit={submit}>
        {!exists && <label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>}
        <label>Password<input type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={exists ? 'current-password' : 'new-password'} required /></label>
        {!exists && <label>Confirm password<input type="password" minLength={10} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? 'Working…' : exists ? 'Unlock' : 'Create encrypted workspace'}</button>
      </form>
      {!exists && <div className="import-lock">
        <span>Already have an encrypted workspace?</span>
        <button className="text-button" disabled={!password || busy} onClick={() => fileRef.current?.click()}>Import .utm</button>
        <input ref={fileRef} hidden type="file" accept=".utm,application/json" onChange={(event) => event.target.files?.[0] && void importWorkspace(event.target.files[0])} />
      </div>}
    </section>
  </main>;
}

const priorityNames: Record<NonNullable<UniversalItem['priority']>, string> = { 0: 'None', 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Urgent' };

function ItemCard({ item, onEdit, onState }: { item: UniversalItem; onEdit: () => void; onState: (state: UniversalItem['state']) => void }) {
  const due = item.schedule?.dueAt ?? item.schedule?.startAt;
  return <article className={`item-card state-${item.state}`}>
    <button className="state-toggle" aria-label={item.state === 'open' ? 'Complete item' : 'Reopen item'} onClick={() => onState(item.state === 'open' ? 'done' : 'open')}>
      {item.state === 'open' ? '' : '✓'}
    </button>
    <button className="item-main" onClick={onEdit}>
      <span className="item-title">{item.title}</span>
      <span className="item-meta">
        <span className={`preset ${item.preset}`}>{item.preset}</span>
        {due && <span>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: item.schedule?.allDay ? undefined : '2-digit', minute: item.schedule?.allDay ? undefined : '2-digit' }).format(new Date(due))}</span>}
        {item.schedule?.estimatedDuration && <span>{item.schedule.estimatedDuration}</span>}
        {item.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
        {item.closure?.reason === 'auto_renew' && <span className="auto-pill">auto-closed</span>}
      </span>
    </button>
    {item.priority ? <button className={`priority p${item.priority}`} title={`Priority ${item.priority}: ${priorityNames[item.priority]}. Click to edit.`} aria-label={`Priority ${item.priority}: ${priorityNames[item.priority]}. Edit item`} onClick={onEdit}>{priorityNames[item.priority]}</button> : null}
  </article>;
}

function filteredItems(workspace: WorkspaceDocument, view?: SavedView): UniversalItem[] {
  // Series templates are recurrence configuration, not user-facing rows. Views
  // operate on logical items (standalone items and materialized occurrences),
  // just as a spreadsheet filter operates on each source row once.
  let items = Object.values(workspace.items).filter((item) => !item.deletedAt && item.role !== 'series_template');
  if (view) {
    try { const predicate = compileQuery(view.query.source || 'true'); items = items.filter((item) => predicate(item)); }
    catch { return []; }
    const sorts = view.sort;
    items.sort((left, right) => {
      for (const sort of sorts) {
        const read = (item: UniversalItem) => sort.field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, item);
        const comparison = String(read(left) ?? '\uffff').localeCompare(String(read(right) ?? '\uffff'));
        if (comparison) return sort.direction === 'asc' ? comparison : -comparison;
      }
      return 0;
    });
  }
  return items;
}

function Widget({ widget, workspace, onEdit, onState, onRemove }: {
  widget: DashboardWidget; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void; onRemove: () => void;
}) {
  const view = widget.viewId ? workspace.views[widget.viewId] : undefined;
  const items = filteredItems(workspace, view);
  const content = (() => {
    if (widget.type === 'markdown') return <div className="markdown"><ReactMarkdown>{widget.markdown ?? 'Write a note in dashboard settings.'}</ReactMarkdown></div>;
    if (widget.type === 'habit_summary') {
      const habits = Object.values(workspace.items).filter((item) => item.preset === 'habit' && item.role !== 'series_template' && item.state === 'open');
      return <div className="habit-grid">{habits.length ? habits.slice(0, 8).map((habit) => <button key={habit.id} onClick={() => onEdit(habit)}><strong>{habit.progress?.current ?? 0}</strong><span>{habit.title}</span><small>of {habit.progress?.target ?? habit.habit?.target ?? 1}</small></button>) : <p className="empty">No active habits</p>}</div>;
    }
    if (widget.type === 'calendar') {
      const dated = items.filter((item) => item.schedule?.startAt || item.schedule?.dueAt).slice(0, 10);
      return <div className="calendar-strip">{dated.length ? dated.map((item) => <button key={item.id} onClick={() => onEdit(item)}><time>{new Date(item.schedule?.startAt ?? item.schedule!.dueAt!).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</time><span>{item.title}</span></button>) : <p className="empty">Nothing scheduled</p>}</div>;
    }
    if (widget.type === 'board') return <div className="mini-board">{(['open', 'done', 'auto_closed'] as const).map((state) => <section key={state}><h4>{state.replace('_', ' ')}</h4>{items.filter((item) => item.state === state).slice(0, 5).map((item) => <button key={item.id} onClick={() => onEdit(item)}>{item.title}</button>)}</section>)}</div>;
    if (widget.type === 'table') return <div className="table-wrap"><table><thead><tr><th>Title</th><th>State</th><th>Due</th><th>Priority</th></tr></thead><tbody>{items.slice(0, 20).map((item) => <tr key={item.id} onClick={() => onEdit(item)}><td>{item.title}</td><td>{item.state}</td><td>{item.schedule?.dueAt?.slice(0, 10) ?? '—'}</td><td>{item.priority ?? 0}</td></tr>)}</tbody></table></div>;
    return <div className="item-list">{items.length ? items.slice(0, 20).map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />) : <p className="empty">This view is clear.</p>}</div>;
  })();
  return <section className={`widget span-${widget.width}`}>
    <header><div><p className="eyebrow">{widget.type.replace('_', ' ')}</p><h2>{widget.title}</h2></div><button className="icon-button subtle" onClick={onRemove} aria-label={`Remove ${widget.title}`}><CloseIcon /></button></header>
    {content}
  </section>;
}

function ItemEditor({ initial, workspace, onSave, onDelete, onClose }: {
  initial: UniversalItem; workspace: WorkspaceDocument; onSave: (item: UniversalItem) => void; onDelete: (item: UniversalItem) => void; onClose: () => void;
}) {
  const [item, setItem] = useState(() => clean(initial));
  const [tags, setTags] = useState(item.tags.join(', '));
  const [contexts, setContexts] = useState(item.contexts.join(', '));
  const [recurring, setRecurring] = useState(item.role === 'series_template');
  const [error, setError] = useState('');
  const definitions = Object.values(workspace.customFields);
  const formulas = evaluateFormulas(item, definitions);
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

  const save = () => {
    setError('');
    try {
      if (!item.title.trim()) throw new Error('Add a title before saving.');
      let result = { ...item, title: item.title.trim(), tags: commaList(tags), contexts: commaList(contexts), updatedAt: new Date().toISOString(), revision: item.revision + (workspace.items[item.id] ? 1 : 0) };
      const existing = workspace.items[item.id];
      if (existing) {
        result.createdWithAppId = existing.createdWithAppId;
        result.createdWithAppName = existing.createdWithAppName;
        result.createdWithVersion = existing.createdWithVersion;
      }
      if (recurring) {
        const anchor = result.schedule?.startAt ?? result.schedule?.dueAt;
        if (!anchor) throw new Error('A recurring item needs a Start or Due date.');
        result = { ...result, schedule: { ...result.schedule!, startAt: anchor } };
        result = makeSeries(result, result.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1', {
          ...result.recurrence,
          activationOffset: result.recurrence?.activationOffset ?? 'P7D',
        });
      }
      if (!recurring) { result.role = 'standalone'; delete result.recurrence; }
      onSave(clean(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="drawer" role="dialog" aria-modal="true" aria-label="Item editor">
      <header className="drawer-head"><div><p className="eyebrow">UNIVERSAL ITEM</p><h2>{workspace.items[item.id] ? 'Edit item' : 'New item'}</h2></div><button className="icon-button" aria-label="Close item editor" onClick={onClose}><CloseIcon /></button></header>
      <div className="editor-scroll">
        <label>Title<input autoFocus value={item.title} onChange={(event) => patchItem({ title: event.target.value })} /></label>
        <div className="segmented" aria-label="Preset">{(['task', 'event', 'habit', 'blank'] as ItemPreset[]).map((preset) => <button className={item.preset === preset ? 'active' : ''} key={preset} onClick={() => patchItem({ preset })}>{preset}</button>)}</div>
        <label>Description <span className="hint">Markdown</span><textarea rows={5} value={item.bodyMarkdown} onChange={(event) => patchItem({ bodyMarkdown: event.target.value })} placeholder="Context, links, checklists…" /></label>
        {item.bodyMarkdown && <details><summary>Markdown preview</summary><div className="markdown preview"><ReactMarkdown>{item.bodyMarkdown}</ReactMarkdown></div></details>}
        <div className="form-grid three">
          <label>Status<select value={item.state} onChange={(event) => patchItem({ state: event.target.value as UniversalItem['state'] })}>{['open', 'done', 'cancelled', 'auto_closed', 'archived'].map((state) => <option key={state}>{state}</option>)}</select></label>
          <label>Priority<select value={item.priority ?? 0} onChange={(event) => patchItem({ priority: Number(event.target.value) as NonNullable<UniversalItem['priority']> })}>{([0, 1, 2, 3, 4] as NonNullable<UniversalItem['priority']>[]).map((priority) => <option key={priority} value={priority}>{priority ? `${priority} — ${priorityNames[priority]}` : 'None'}</option>)}</select></label>
          <label>Estimate<input value={item.schedule?.estimatedDuration ?? ''} onChange={(event) => patchSchedule({ estimatedDuration: event.target.value })} placeholder="PT45M" /></label>
        </div>
        <label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="work, deep-focus" /></label>
        <label>Contexts<input value={contexts} onChange={(event) => setContexts(event.target.value)} placeholder="office, laptop" /></label>

        <details open={item.preset === 'event'}><summary>Schedule & deadline</summary><div className="details-body">
          <div className="form-grid two">
            <label>Available from<input type="datetime-local" value={dateInput(item.schedule?.availableFrom)} onInput={(event) => patchSchedule({ availableFrom: fromDateInput(event.currentTarget.value) })} /></label>
            <label>Start<input type="datetime-local" value={dateInput(item.schedule?.startAt)} onInput={(event) => patchSchedule({ startAt: fromDateInput(event.currentTarget.value) })} /></label>
            <label>End<input type="datetime-local" value={dateInput(item.schedule?.endAt)} onInput={(event) => patchSchedule({ endAt: fromDateInput(event.currentTarget.value) })} /></label>
            <label>Due<input type="datetime-local" value={dateInput(item.schedule?.dueAt)} onInput={(event) => patchSchedule({ dueAt: fromDateInput(event.currentTarget.value) })} /></label>
          </div>
          <label>Timezone<input value={item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(event) => patchSchedule({ timezone: event.target.value })} /></label>
        </div></details>

        <details open={recurring}><summary>Recurrence & auto-renew</summary><div className="details-body">
          <label className="check"><input type="checkbox" checked={recurring} onChange={(event) => setRecurring(event.target.checked)} /> Make this a recurring series</label>
          {recurring && <>
            <label>RRULE<input value={item.recurrence?.rrule ?? 'FREQ=WEEKLY;INTERVAL=1'} onChange={(event) => patchItem({ recurrence: { rrule: event.target.value, rdates: item.recurrence?.rdates ?? [], exdates: item.recurrence?.exdates ?? [], timezone: item.schedule?.timezone ?? 'UTC', activationOffset: item.recurrence?.activationOffset ?? 'P7D', closeAt: item.recurrence?.closeAt ?? 'next_activation', anchor: item.recurrence?.anchor ?? 'schedule', autoRenew: item.recurrence?.autoRenew ?? true } })} /></label>
            <div className="form-grid two"><label>Activation offset<input value={item.recurrence?.activationOffset ?? 'P7D'} onChange={(event) => item.recurrence && patchItem({ recurrence: { ...item.recurrence, activationOffset: event.target.value } })} /></label>
            <label>Auto-close<select value={item.recurrence?.closeAt ?? 'next_activation'} onChange={(event) => item.recurrence && patchItem({ recurrence: { ...item.recurrence, closeAt: event.target.value as NonNullable<UniversalItem['recurrence']>['closeAt'] } })}><option value="next_activation">At next activation</option><option value="due">At due time</option><option value="never">Never</option></select></label></div>
            <label className="check"><input type="checkbox" checked={item.recurrence?.autoRenew ?? true} onChange={(event) => item.recurrence && patchItem({ recurrence: { ...item.recurrence, autoRenew: event.target.checked } })} /> Auto-close untouched cycles</label>
          </>}
        </div></details>

        <details open={item.preset === 'habit'}><summary>Progress & habit</summary><div className="details-body">
          <div className="form-grid three"><label>Mode<select value={item.progress?.mode ?? 'counter'} onChange={(event) => patchItem({ progress: { mode: event.target.value as 'counter', current: item.progress?.current ?? 0, target: item.progress?.target ?? 1 } })}><option>boolean</option><option>percent</option><option>counter</option></select></label>
          <label>Current<input type="number" value={item.progress?.current ?? 0} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: Number(event.target.value), target: item.progress?.target ?? 1 } })} /></label>
          <label>Target<input type="number" value={item.progress?.target ?? 1} onChange={(event) => patchItem({ progress: { mode: item.progress?.mode ?? 'counter', current: item.progress?.current ?? 0, target: Number(event.target.value) } })} /></label></div>
          <label className="check"><input type="checkbox" checked={Boolean(item.habit)} onChange={(event) => patchItem({ habit: event.target.checked ? { target: item.progress?.target ?? 1, unit: 'times', streakMode: 'manual_only' } : undefined })} /> Track as a habit</label>
        </div></details>

        <details><summary>Reminders</summary><div className="details-body">
          {item.reminders.map((reminder, index) => <div className="inline-row" key={reminder.id}><input type="datetime-local" value={dateInput(reminder.at)} onInput={(event) => patchItem({ reminders: item.reminders.map((entry, at) => { if (at !== index) return entry; const next = { ...entry }; const value = fromDateInput(event.currentTarget.value); if (value) next.at = value; else delete next.at; return next; }) })} /><select value={reminder.urgency} onChange={(event) => patchItem({ reminders: item.reminders.map((entry, at) => at === index ? { ...entry, urgency: event.target.value as typeof entry.urgency } : entry) })}><option>normal</option><option>urgent</option><option>critical</option></select><button aria-label="Remove reminder" onClick={() => patchItem({ reminders: item.reminders.filter((_, at) => at !== index) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => patchItem({ reminders: [...item.reminders, { id: createId(), mode: 'absolute', at: new Date(Date.now() + 3_600_000).toISOString(), urgency: 'normal', repeatUntilAcknowledged: false }] })}>+ Add reminder</button>
        </div></details>

        <details><summary>Relations & links</summary><div className="details-body">
          {item.relations.map((relation) => <div className="chip" key={relation.id}>{relation.type}: {workspace.items[relation.targetId]?.title ?? relation.targetId}<button aria-label="Remove relation" onClick={() => patchItem({ relations: item.relations.filter((entry) => entry.id !== relation.id) })}><CloseIcon /></button></div>)}
          <div className="inline-row"><select id="relation-target" defaultValue=""><option value="">Choose related item…</option>{Object.values(workspace.items).filter((candidate) => candidate.id !== item.id && !candidate.deletedAt).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}</select><button className="secondary" onClick={() => { const select = document.getElementById('relation-target') as HTMLSelectElement; if (select.value) patchItem({ relations: [...item.relations, { id: createId(), targetId: select.value, type: 'related' }] }); }}>Link</button></div>
          {item.attachments.map((attachment) => <div className="chip" key={attachment.id}><a href={attachment.url} target="_blank" rel="noreferrer">{attachment.title ?? attachment.url}</a><button aria-label="Remove link" onClick={() => patchItem({ attachments: item.attachments.filter((entry) => entry.id !== attachment.id) })}><CloseIcon /></button></div>)}
          <button className="secondary" onClick={() => { const url = window.prompt('Link URL'); if (url) patchItem({ attachments: [...item.attachments, { id: createId(), url }] }); }}>+ Add link</button>
        </div></details>

        {definitions.length > 0 && <details><summary>Custom fields</summary><div className="details-body">{definitions.map((field) => <label key={field.id}>{field.label}{field.kind === 'formula' ? <output className="formula-output">{String(formulas.values[field.key] ?? formulas.errors[field.key] ?? '—')}</output> : <input value={String(item.custom[field.key] ?? '')} onChange={(event) => patchItem({ custom: { ...item.custom, [field.key]: field.kind === 'number' ? Number(event.target.value) : field.kind === 'boolean' ? event.target.value === 'true' : event.target.value } })} />}</label>)}</div></details>}
        <details><summary>System metadata</summary><div className="details-body metadata-grid"><div><span>Created at</span><output><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></output></div><div><span>Last modified</span><output><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></output></div><div><span>Created by application</span><output>{item.createdWithAppName} v{item.createdWithVersion}</output></div><div><span>Application ID</span><output className="mono">{item.createdWithAppId}</output></div><div><span>Item schema</span><output>{item.schemaVersion}</output></div><div><span>Item ID</span><output>{item.id}</output></div></div></details>
      </div>
      {error && <p className="editor-error error" role="alert">{error}</p>}
      <footer className="drawer-actions">{workspace.items[item.id] && <button className="danger" onClick={() => onDelete(item)}>Delete</button>}<span /><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save item</button></footer>
    </section>
  </div>;
}

function ViewResults({ view, workspace, onEdit, onState }: {
  view: SavedView; workspace: WorkspaceDocument; onEdit: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void;
}) {
  const items = filteredItems(workspace, view);
  if (!items.length) return <p className="empty">No items match this view.</p>;
  if (view.renderer === 'calendar') {
    const dated = items.filter((item) => item.schedule?.startAt || item.schedule?.dueAt);
    return dated.length ? <div className="calendar-strip">{dated.map((item) => <button key={item.id} onClick={() => onEdit(item)}><time>{new Date(item.schedule?.startAt ?? item.schedule!.dueAt!).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</time><span>{item.title}</span></button>)}</div> : <p className="empty">Matching items have no dates.</p>;
  }
  if (view.renderer === 'board') {
    return <div className="mini-board">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => <section key={state}><h4>{state.replace('_', ' ')}</h4>{items.filter((item) => item.state === state).map((item) => <button key={item.id} onClick={() => onEdit(item)}>{item.title}</button>)}</section>)}</div>;
  }
  if (view.renderer === 'table') {
    const fields = view.fields.length ? view.fields : ['title', 'state', 'schedule.dueAt', 'priority'];
    const read = (item: UniversalItem, field: string) => field.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, item);
    const display = (value: unknown, field: string) => {
      if (value === undefined || value === null || value === '') return '—';
      if ((field.endsWith('At') || field === 'date') && typeof value === 'string') return new Date(value).toLocaleString();
      if (Array.isArray(value)) return value.join(', ');
      return String(value);
    };
    return <div className="table-wrap"><table><thead><tr>{fields.map((field) => <th key={field}>{field.replace('schedule.', '')}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} onClick={() => onEdit(item)}>{fields.map((field) => <td key={field}>{display(read(item, field), field)}</td>)}</tr>)}</tbody></table></div>;
  }
  return <div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} onEdit={() => onEdit(item)} onState={(state) => onState(item, state)} />)}</div>;
}

function SavedViewSection({ view, workspace, onEditView, onEditItem, onState }: {
  view: SavedView; workspace: WorkspaceDocument; onEditView: () => void; onEditItem: (item: UniversalItem) => void;
  onState: (item: UniversalItem, state: UniversalItem['state']) => void;
}) {
  const [open, setOpen] = useState(true);
  return <details className="view-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="view-section-summary"><div><span className="view-renderer">{view.renderer}</span><h2>{view.name}</h2><code>{view.query.source}</code><p>{filteredItems(workspace, view).length} matching items</p></div><button className="secondary" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onEditView(); }}>Edit view</button></summary>
    <div className="view-section-body"><ViewResults view={view} workspace={workspace} onEdit={onEditItem} onState={onState} /></div>
  </details>;
}

function ViewsPage({ workspace, commit, onEditItem, onState }: {
  workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void;
  onEditItem: (item: UniversalItem) => void; onState: (item: UniversalItem, state: UniversalItem['state']) => void;
}) {
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [error, setError] = useState('');
  const [visualField, setVisualField] = useState('state');
  const [visualOperator, setVisualOperator] = useState('==');
  const [visualValue, setVisualValue] = useState('open');
  const [visualDirty, setVisualDirty] = useState(false);

  const literal = (value: string) => ['true', 'false', 'null'].includes(value) || (!Number.isNaN(Number(value)) && value.trim() !== '') ? value : JSON.stringify(value);
  const visualClause = () => `${visualField} ${visualOperator} ${literal(visualValue)}`;
  const beginEditing = (view: SavedView) => {
    const copy = clean(view);
    const firstClause = /^\s*([\w.]+)\s*(==|!=|>=|<=|>|<|in)\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)/.exec(copy.query.source);
    setEditing(copy);
    setVisualField(firstClause?.[1] ?? 'state');
    setVisualOperator(firstClause?.[2] ?? '==');
    if (firstClause?.[3]) {
      try { setVisualValue(String(JSON.parse(firstClause[3]))); }
      catch { setVisualValue(firstClause[3]); }
    } else setVisualValue('open');
    setVisualDirty(false);
    setError('');
  };
  const changeVisual = (part: 'field' | 'operator' | 'value', value: string) => {
    if (part === 'field') setVisualField(value);
    if (part === 'operator') setVisualOperator(value);
    if (part === 'value') setVisualValue(value);
    setVisualDirty(true);
  };
  const applyVisual = (join: 'replace' | 'and' | 'or') => {
    if (!editing) return;
    const clause = visualClause();
    const connector = join === 'and' ? '&&' : '||';
    setEditing({ ...editing, query: { source: join !== 'replace' && editing.query.source ? `${editing.query.source} ${connector} ${clause}` : clause } });
    setVisualDirty(false);
  };
  const save = () => {
    if (!editing) return;
    const result = visualDirty ? { ...editing, query: { source: visualClause() } } : editing;
    try {
      parseExpression(result.query.source);
      commit('Save view', (draft) => { draft.views[result.id] = clean(result); });
      setEditing(null);
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const newView = () => beginEditing({ id: createId(), name: 'New view', query: { source: 'state == "open"' }, renderer: 'list', sort: [{ field: 'updatedAt', direction: 'desc' }], fields: ['title', 'state'] });

  return <section className="page-section">
    <div className="page-title"><div><p className="eyebrow">PROGRAMMABLE LISTS</p><h1>Views</h1><p>Every section below is a live result of its visual clauses or DSL expression.</p></div><button className="primary" onClick={newView}>+ New view</button></div>
    <div className="views-stack">{Object.values(workspace.views).map((view) => <SavedViewSection key={view.id} view={view} workspace={workspace} onEditView={() => beginEditing(view)} onEditItem={onEditItem} onState={onState} />)}</div>
    {editing && <div className="modal-backdrop"><section className="dialog view-editor">
      <header><div><p className="dialog-kicker">SAVED VIEW</p><h2>Edit view</h2></div><button className="icon-button" aria-label="Close view editor" onClick={() => setEditing(null)}><CloseIcon /></button></header>
      <label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
      <fieldset className="query-builder"><legend>Visual condition</legend>
        <div className="form-grid three">
          <label>Field<select value={visualField} onChange={(event) => changeVisual('field', event.target.value)}><option>state</option><option>preset</option><option>role</option><option>priority</option><option>schedule.dueAt</option><option>title</option></select></label>
          <label>Operator<select value={visualOperator} onChange={(event) => changeVisual('operator', event.target.value)}><option>==</option><option>!=</option><option>&gt;</option><option>&gt;=</option><option>&lt;</option><option>&lt;=</option><option>in</option></select></label>
          <label>Value<input value={visualValue} onChange={(event) => changeVisual('value', event.target.value)} /></label>
        </div>
        <p className="builder-status">{visualDirty ? 'This condition will replace the DSL expression when you save.' : 'Visual condition and DSL are synchronized.'}</p>
        <div className="builder-actions"><button className="secondary compact-action" onClick={() => applyVisual('replace')}>Apply condition</button><button className="secondary compact-action" onClick={() => applyVisual('and')}>+ Add AND condition</button><button className="secondary compact-action" onClick={() => applyVisual('or')}>+ Add OR condition</button></div>
      </fieldset>
      <label className="dsl-field">DSL expression<span className="hint">Safe typed expression</span><textarea className="dsl-input" spellCheck={false} rows={5} value={editing.query.source} onChange={(event) => { setEditing({ ...editing, query: { source: event.target.value } }); setVisualDirty(false); }} /></label>
      <label>Renderer<select value={editing.renderer} onChange={(event) => setEditing({ ...editing, renderer: event.target.value as SavedView['renderer'] })}><option>list</option><option>table</option><option>calendar</option><option>board</option></select></label>
      {error && <p className="error">{error}</p>}
      <footer><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={save}>Save view</button></footer>
    </section></div>}
  </section>;
}

function AutomationsPage({ workspace, commit }: { workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void }) {
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [actions, setActions] = useState('[]');
  const [error, setError] = useState('');
  const edit = (rule: AutomationRule) => { setEditing(clean(rule)); setActions(JSON.stringify(rule.actions, null, 2)); };
  return <section className="page-section"><div className="page-title"><div><p className="eyebrow">IF → THEN, LOCALLY</p><h1>Automations</h1><p>Rules can change your workspace, but cannot run code or access the network.</p></div><button className="primary" onClick={() => edit({ id: createId(), name: 'New automation', enabled: true, trigger: { type: 'item.created' }, condition: { source: 'true' }, actions: [{ type: 'notify', title: 'Created', body: 'A new item was created' }], missedPolicy: 'run_each', maxDepth: 5, cooldownMs: 0 })}>+ New automation</button></div>
    <div className="automation-layout"><div className="rule-list">{Object.values(workspace.automations).map((rule) => <article className="rule-card" key={rule.id}><div><span className={`status-dot ${rule.enabled ? 'on' : ''}`} /><strong>{rule.name}</strong><small>{rule.trigger.type}</small></div><code>{rule.condition.source}</code>{rule.disabledReason && <p className="error">{rule.disabledReason}</p>}<footer><button className="secondary" onClick={() => commit('Toggle rule', (draft) => { draft.automations[rule.id]!.enabled = !draft.automations[rule.id]!.enabled; delete draft.automations[rule.id]!.disabledReason; })}>{rule.enabled ? 'Disable' : 'Enable'}</button><button className="secondary" onClick={() => edit(rule)}>Edit</button></footer></article>)}{!Object.keys(workspace.automations).length && <div className="empty-panel"><svg className="automation-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.2h7.3L11 22l8.5-11.2h-7.3L13 2Z" /></svg><h3>No automations yet</h3><p>Create a safe rule for repetitive work.</p></div>}</div><aside className="log-panel"><h3>Execution log</h3>{workspace.automationLog.slice(-20).reverse().map((entry) => <div className="log-line" key={entry.id}><span className={`status-dot ${entry.outcome === 'success' ? 'on' : entry.outcome === 'failed' ? 'bad' : ''}`} /><div><strong>{workspace.automations[entry.ruleId]?.name ?? 'Deleted rule'}</strong><small>{entry.outcome} · {new Date(entry.finishedAt).toLocaleString()}</small></div></div>)}{!workspace.automationLog.length && <p className="empty">Runs will appear here.</p>}</aside></div>
    {editing && <div className="modal-backdrop"><section className="dialog wide-dialog"><header><h2>Automation rule</h2><button className="icon-button" onClick={() => setEditing(null)}>×</button></header><label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><div className="form-grid two"><label>Trigger<select value={editing.trigger.type} onChange={(event) => setEditing({ ...editing, trigger: { type: event.target.value as AutomationRule['trigger']['type'] } })}>{['item.created', 'item.updated', 'status.changed', 'occurrence.activated', 'occurrence.boundary', 'reminder.due', 'time.schedule'].map((trigger) => <option key={trigger}>{trigger}</option>)}</select></label><label>Missed runs<select value={editing.missedPolicy} onChange={(event) => setEditing({ ...editing, missedPolicy: event.target.value as AutomationRule['missedPolicy'] })}><option value="run_each">Run each</option><option value="run_once">Run once</option><option value="skip">Skip</option></select></label></div>{editing.trigger.type === 'time.schedule' && <label>Schedule RRULE<input value={editing.trigger.rrule ?? 'FREQ=DAILY;BYHOUR=9'} onChange={(event) => setEditing({ ...editing, trigger: { ...editing.trigger, rrule: event.target.value } })} /></label>}<label>Condition DSL<input value={editing.condition.source} onChange={(event) => setEditing({ ...editing, condition: { source: event.target.value } })} /></label><label>Actions <span className="hint">allowlisted JSON</span><textarea className="code-area" rows={11} value={actions} onChange={(event) => setActions(event.target.value)} /></label><p className="hint">Actions: set_field, close, archive, create_item, add_relation, set_progress, add_reminder, notify.</p>{error && <p className="error">{error}</p>}<footer><button className="danger" onClick={() => { commit('Delete automation', (draft) => { delete draft.automations[editing.id]; }); setEditing(null); }}>Delete</button><span /><button className="secondary" onClick={() => setEditing(null)}>Cancel</button><button className="primary" onClick={() => { try { parseExpression(editing.condition.source || 'true'); const parsed = JSON.parse(actions) as AutomationAction[]; if (!Array.isArray(parsed)) throw new Error('Actions must be an array'); commit('Save automation', (draft) => { draft.automations[editing.id] = clean({ ...editing, actions: parsed }); }); setEditing(null); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>Save rule</button></footer></section></div>}
  </section>;
}

function SettingsPage({ workspace, commit, onNotify }: { workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void; onNotify: () => void }) {
  const [field, setField] = useState<CustomFieldDefinition | null>(null);
  return <section className="page-section"><div className="page-title"><div><p className="eyebrow">SHAPE YOUR SYSTEM</p><h1>Settings</h1><p>Fields and capabilities belong to you, not to a hard-coded task type.</p></div></div>
    <div className="settings-columns"><section className="settings-card"><header><div><p className="eyebrow">DATA MODEL</p><h2>Custom fields</h2></div><button className="secondary" onClick={() => setField({ id: createId(), key: '', label: '', kind: 'text', required: false })}>+ Add</button></header>{Object.values(workspace.customFields).map((entry) => <button className="setting-row" key={entry.id} onClick={() => setField(clean(entry))}><span><strong>{entry.label}</strong><small>custom.{entry.key}</small></span><span>{entry.kind}</span></button>)}{!Object.keys(workspace.customFields).length && <p className="empty">No custom fields yet.</p>}</section>
    <section className="settings-card"><p className="eyebrow">DEVICE</p><h2>Notifications</h2><p>While this local-only PWA is open, due reminders can use system notifications. Closed-app delivery is not guaranteed.</p><button className="secondary" onClick={onNotify}>Request permission</button><hr/><p className="eyebrow">APPLICATION</p><h2>{APP_NAME}</h2><dl><div><dt>Version</dt><dd>v{APP_VERSION}</dd></div><div><dt>Released</dt><dd><time dateTime={APP_RELEASED_AT}>{new Date(APP_RELEASED_AT).toLocaleString()}</time></dd></div></dl><hr/><p className="eyebrow">WORKSPACE</p><h2>{workspace.name}</h2><dl><div><dt>Schema</dt><dd>{workspace.schemaVersion}</dd></div><div><dt>Items</dt><dd>{Object.keys(workspace.items).length}</dd></div><div><dt>Workspace ID</dt><dd className="mono">{workspace.workspaceId}</dd></div></dl></section></div>
    {field && <div className="modal-backdrop"><section className="dialog"><header><h2>Custom field</h2><button className="icon-button" onClick={() => setField(null)}>×</button></header><label>Label<input value={field.label} onChange={(event) => setField({ ...field, label: event.target.value, key: field.key || event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_') })} /></label><label>Key<input value={field.key} pattern="[a-z][a-z0-9_]*" onChange={(event) => setField({ ...field, key: event.target.value })} /></label><label>Type<select value={field.kind} onChange={(event) => setField({ ...field, kind: event.target.value as CustomFieldDefinition['kind'] })}>{['text', 'number', 'boolean', 'date', 'datetime', 'duration', 'enum', 'multi_enum', 'url', 'item_ref', 'formula'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>{field.kind === 'formula' && <label>Formula DSL<input value={field.formula ?? ''} onChange={(event) => setField({ ...field, formula: event.target.value })} placeholder="custom.rate * custom.hours" /></label>}<footer><button className="danger" onClick={() => { commit('Delete custom field', (draft) => { delete draft.customFields[field.id]; }); setField(null); }}>Delete</button><span/><button className="primary" disabled={!field.label || !/^[a-z][a-z0-9_]*$/.test(field.key)} onClick={() => { if (field.formula) parseExpression(field.formula); commit('Save custom field', (draft) => { draft.customFields[field.id] = clean(field); }); setField(null); }}>Save field</button></footer></section></div>}
  </section>;
}

function TransferDialog({ session, onMerged, onClose }: { session: UnlockedWorkspace; onMerged: (session: UnlockedWorkspace, message: string) => void; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const download = async () => {
    setBusy(true); setError('');
    try {
      const content = await exportContainer(session.document, password);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/x-utm' }));
      const link = document.createElement('a'); link.href = url; link.download = `${session.document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workspace'}.utm`; link.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    setBusy(true); setError('');
    try { const result = await mergeIntoLocalWorkspace(session, await file.text(), password); onMerged(result.unlocked, `Merged ${result.changedItems} changed items`); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div className="modal-backdrop"><section className="dialog"><header><h2>Encrypted transfer</h2><button className="icon-button" onClick={onClose}>×</button></header><p>Every exported file is encrypted. Use the same workspace password when merging on another device.</p><label>Workspace password<input type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="error">{error}</p>}<div className="transfer-actions"><button className="primary" disabled={password.length < 10 || busy} onClick={() => void download()}>Export encrypted .utm</button><button className="secondary" disabled={password.length < 10 || busy} onClick={() => input.current?.click()}>Merge from .utm</button><input ref={input} hidden type="file" accept=".utm,application/json" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} /></div><p className="hint">Wrong passwords and modified containers are rejected before your local workspace changes.</p></section></div>;
}

export default function App() {
  const [boot, setBoot] = useState<'checking' | 'empty' | 'locked' | 'ready'>('checking');
  const [session, setSession] = useState<UnlockedWorkspace | null>(null);
  const [page, setPage] = useState<Page>('home');
  const [editor, setEditor] = useState<UniversalItem | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [popupNoticeIds, setPopupNoticeIds] = useState<string[]>([]);
  const [noticeCenterOpen, setNoticeCenterOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [quick, setQuick] = useState('');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const seenNoticeIds = useRef(new Set<string>());
  const noticeTimers = useRef(new Map<string, number>());

  useEffect(() => { void hasLocalWorkspace().then((exists) => setBoot(exists ? 'locked' : 'empty')); }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const fresh = notices.filter((notice) => !seenNoticeIds.current.has(notice.id));
    if (!fresh.length) return;
    fresh.forEach((notice) => {
      seenNoticeIds.current.add(notice.id);
      const timer = window.setTimeout(() => {
        setPopupNoticeIds((current) => current.filter((id) => id !== notice.id));
        noticeTimers.current.delete(notice.id);
      }, 3_000);
      noticeTimers.current.set(notice.id, timer);
    });
    setPopupNoticeIds((current) => [...current, ...fresh.map((notice) => notice.id)]);
  }, [notices]);
  useEffect(() => () => { noticeTimers.current.forEach((timer) => window.clearTimeout(timer)); }, []);

  const activate = async (unlocked: UnlockedWorkspace) => {
    let notifications: Array<{ title: string; body: string; itemId?: string }> = [];
    const now = new Date();
    const migratedDocument = Automerge.change(unlocked.document, 'Backfill item creation versions', (draft) => {
      backfillItemCreationVersions(draft as unknown as WorkspaceDocument);
    });
    let reconciliation: ReconcileResult;
    try { reconciliation = await reconcileOffMainThread(migratedDocument as WorkspaceDocument, now); }
    catch { reconciliation = reconcileRecurrences(clean(migratedDocument as WorkspaceDocument), now); }
    const updated = Automerge.change(migratedDocument, 'Unlock reconciliation', (draft) => {
      const workspace = draft as unknown as WorkspaceDocument;
      reconciliation.created.forEach((item) => { if (!workspace.items[item.id]) workspace.items[item.id] = clean(item); });
      reconciliation.autoClosed.forEach((item) => { workspace.items[item.id] = clean(item); });
      const events: DomainEvent[] = reconciliation.created.map((item) => ({ id: createId(), type: 'occurrence.activated', at: now.toISOString(), itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }));
      events.push(...collectScheduledEvents(workspace, now));
      notifications = runAutomationEvents(workspace, events, { now }).notifications;
    });
    for (const item of Object.values(updated.items)) {
      for (const reminder of item.reminders) {
        if (!reminder.acknowledgedAt && reminder.at && new Date(reminder.at) <= now) notifications.push({ title: item.title, body: `Reminder · ${reminder.urgency}`, itemId: item.id });
      }
    }
    await saveLocalWorkspace(updated, unlocked.dataKey);
    setSession({ ...unlocked, document: updated }); setBoot('ready');
    setNotices(notifications.map((notice) => ({ id: createId(), title: notice.title, body: notice.body, at: now.toISOString() })));
    if (Notification.permission === 'granted') notifications.forEach((notice) => new Notification(notice.title, { body: notice.body, ...(notice.itemId ? { tag: notice.itemId } : {}) }));
  };

  const workspace = session?.document as WorkspaceDocument | undefined;
  const commit = (message: string, mutation: (draft: WorkspaceDocument) => void) => {
    if (!session) return;
    const document = Automerge.change(session.document, message, (draft) => { mutation(draft as unknown as WorkspaceDocument); draft.updatedAt = new Date().toISOString(); });
    const next = { ...session, document };
    setSession(next);
    saveQueue.current = saveQueue.current.then(() => saveLocalWorkspace(document, session.dataKey)).catch((reason) => { setToast(`Save failed: ${String(reason)}`); });
  };

  const changeItemState = (item: UniversalItem, state: UniversalItem['state']) => commit('Change item state', (draft) => {
    const target = draft.items[item.id]; if (!target) return;
    target.state = state; target.updatedAt = new Date().toISOString(); target.revision += 1;
    if (state === 'open') delete target.closure;
    else target.closure = { at: target.updatedAt, actor: 'user', reason: state === 'cancelled' ? 'cancelled' : 'manual' };
    const event = { id: createId(), type: 'status.changed' as const, at: target.updatedAt, itemId: target.id, before: clean(item), after: clean(target as unknown as UniversalItem), causationId: createId(), depth: 0 };
    const result = runAutomationEvents(draft, [event]);
    if (result.notifications.length) setNotices((current) => [...current, ...result.notifications.map((notice) => ({ ...notice, id: createId(), at: new Date().toISOString() }))]);
  });
  const dismissPopupNotice = (id: string) => {
    const timer = noticeTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    noticeTimers.current.delete(id);
    setPopupNoticeIds((current) => current.filter((candidate) => candidate !== id));
  };
  const deleteNotice = (id: string) => {
    dismissPopupNotice(id);
    setNotices((current) => current.filter((notice) => notice.id !== id));
  };
  const openNoticeItem = (notice: Notice) => {
    const item = Object.values(workspace?.items ?? {}).find((candidate) => candidate.title === notice.title);
    if (item) setEditor(item);
  };

  if (boot === 'checking') return <main className="splash"><div className="brand-mark">U</div><p>Opening encrypted workspace…</p></main>;
  if (boot === 'empty' || boot === 'locked') return <LockScreen exists={boot === 'locked'} onReady={(readySession) => void activate(readySession)} />;
  if (!workspace || !session) return null;

  const dashboard = Object.values(workspace.dashboards)[0];
  const nav: Array<[Page, LineIconName, string]> = [['home', 'home', 'Home'], ['all', 'items', 'All items'], ['views', 'views', 'Views'], ['automations', 'rules', 'Automations'], ['settings', 'settings', 'Settings']];
  const openItems = Object.values(workspace.items).filter((item) => item.state === 'open' && item.role !== 'series_template' && !item.deletedAt).length;

  return <div className="app-shell">
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label}</span>{target === 'all' && <b>{openItems}</b>}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setTransfer(true)}><LineIcon name="transfer"/><span>Transfer</span></button><button onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/><span>Lock</span></button></div></aside>
    <main className="content">
      <header className="topbar"><div><span className="mobile-brand">Universal</span><span className="sync-state"><i /> Encrypted locally</span></div><div className="top-actions"><button className="mobile-only-lock" aria-label="Lock" onClick={() => { lock(session); setSession(null); setBoot('locked'); }}><LineIcon name="lock"/></button><button className="notice-button" aria-label="Notifications" aria-expanded={noticeCenterOpen} onClick={() => { setNoticeCenterOpen((open) => !open); setPopupNoticeIds([]); }} title="Notifications"><LineIcon name="bell"/>{notices.length > 0 && <b>{notices.length}</b>}</button><button className="primary compact" onClick={() => setEditor(createItem('', 'task'))}>+ New item</button></div></header>
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is Notice => Boolean(notice)).map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button className="notice-dismiss" aria-label="Close notification" onClick={() => dismissPopupNotice(notice.id)}><CloseIcon /></button></article>)}</div>}
      {noticeCenterOpen && <aside className="notification-center" aria-label="Notification center"><header><h2>Notifications</h2><button className="icon-button" aria-label="Close notification center" onClick={() => setNoticeCenterOpen(false)}><CloseIcon /></button></header><div className="notification-list">{notices.length ? notices.slice().reverse().map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => openNoticeItem(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button className="notice-dismiss" aria-label="Delete notification" onClick={() => deleteNotice(notice.id)}><CloseIcon /></button></article>) : <p className="empty">No notifications</p>}</div></aside>}
      {page === 'home' && <section className="page-section"><div className="home-hero"><div><p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</p><h1>{openItems ? `${openItems} open ${openItems === 1 ? 'item' : 'items'}` : 'Everything is clear'}</h1><p>Your dashboard is a view of the system, not another inbox.</p></div><div className="quick-capture"><input value={quick} onChange={(event) => setQuick(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && quick.trim()) { const item = createItem(quick.trim()); commit('Quick capture', (draft) => { draft.items[item.id] = clean(item); runAutomationEvents(draft, [{ id: createId(), type: 'item.created', at: item.createdAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }]); }); setQuick(''); } }} placeholder="Capture anything…"/><span>↵</span></div></div><div className="dashboard-grid">{dashboard?.widgets.slice().sort((a, b) => a.order - b.order).map((widget) => <Widget key={widget.id} widget={widget} workspace={workspace} onEdit={setEditor} onState={changeItemState} onRemove={() => commit('Remove dashboard widget', (draft) => { draft.dashboards[dashboard.id]!.widgets = draft.dashboards[dashboard.id]!.widgets.filter((entry) => entry.id !== widget.id); })} />)}<button className="add-widget" onClick={() => { const type = window.prompt('Widget type: smart_list, table, calendar, board, habit_summary, markdown', 'smart_list') as DashboardWidget['type'] | null; if (!type || !['smart_list', 'table', 'calendar', 'board', 'habit_summary', 'markdown'].includes(type)) return; const viewId = Object.keys(workspace.views)[0]; commit('Add dashboard widget', (draft) => { draft.dashboards[dashboard!.id]!.widgets.push({ id: createId(), type, title: type.replace('_', ' '), ...(type !== 'habit_summary' && type !== 'markdown' ? { viewId } : {}), ...(type === 'markdown' ? { markdown: '## A flexible space\nWrite anything here.' } : {}), width: type === 'habit_summary' ? 1 : 2, order: dashboard!.widgets.length }); }); }}>+ Add widget</button></div></section>}
      {page === 'all' && <section className="page-section"><div className="page-title"><div><p className="eyebrow">EVERYTHING, WITHOUT SILOS</p><h1>All items</h1><p>Tasks, events and habits share one universal shape.</p></div><button className="primary" onClick={() => setEditor(createItem('', 'blank'))}>+ New item</button></div><div className="all-sections">{(['open', 'done', 'auto_closed', 'cancelled', 'archived'] as const).map((state) => { const items = Object.values(workspace.items).filter((item) => item.state === state && item.role !== 'series_template' && !item.deletedAt); return <details key={state} open={state === 'open' || state === 'auto_closed'}><summary><span>{state.replace('_', ' ')}</span><b>{items.length}</b></summary><div className="item-list">{items.map((item) => <ItemCard key={item.id} item={item} onEdit={() => setEditor(item)} onState={(nextState) => changeItemState(item, nextState)} />)}</div></details>; })}<details><summary><span>series templates</span><b>{Object.values(workspace.items).filter((item) => item.role === 'series_template').length}</b></summary><div className="item-list">{Object.values(workspace.items).filter((item) => item.role === 'series_template').map((item) => <ItemCard key={item.id} item={item} onEdit={() => setEditor(item)} onState={(nextState) => changeItemState(item, nextState)} />)}</div></details></div></section>}
      {page === 'views' && <ViewsPage workspace={workspace} commit={commit} onEditItem={setEditor} onState={changeItemState} />}
      {page === 'automations' && <AutomationsPage workspace={workspace} commit={commit} />}
      {page === 'settings' && <SettingsPage workspace={workspace} commit={commit} onNotify={() => void Notification.requestPermission().then((permission) => setToast(`Notification permission: ${permission}`))} />}
    </main>
    <nav className="bottom-nav">{nav.slice(0, 5).map(([target, icon, label]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => setPage(target)}><LineIcon name={icon}/><span>{label === 'Automations' ? 'Rules' : label}</span></button>)}</nav>
    {editor && <ItemEditor initial={editor} workspace={workspace} onClose={() => setEditor(null)} onSave={(item) => { const isNew = !workspace.items[item.id]; commit(isNew ? 'Create item' : 'Update item', (draft) => { draft.items[item.id] = clean(item); const event = { id: createId(), type: isNew ? 'item.created' as const : 'item.updated' as const, at: item.updatedAt, itemId: item.id, after: clean(item), causationId: createId(), depth: 0 }; runAutomationEvents(draft, [event]); if (item.role === 'series_template') reconcileRecurrences(draft); }); setEditor(null); }} onDelete={(item) => { commit('Delete item', (draft) => { const target = draft.items[item.id]; if (target) { target.deletedAt = new Date().toISOString(); draft.tombstones[item.id] = target.deletedAt; } }); setEditor(null); }} />}
    {transfer && <TransferDialog session={session} onClose={() => setTransfer(false)} onMerged={(next, message) => { setSession(next); setToast(message); }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
