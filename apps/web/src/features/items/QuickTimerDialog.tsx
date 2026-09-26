import { useEffect, useState } from 'react';
import { addTimerActualTime, createItem, durationToMs, type WorkspaceDocument, type UniversalItem } from '@utm/core';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Input, Select } from '../../components/ui/primitives';
import { QuickItemTimer } from './editor/QuickItemTimer';
import './quick-timer-dialog.css';

type Commit = (message: string, change: (draft: WorkspaceDocument) => void) => unknown;
export function storeQuickTimer(draft: WorkspaceDocument, active: UniversalItem['activeTimer']) {
  const state = draft.quickTimer ??= {};
  if (active) state.active = active; else delete state.active;
  if (active?.stoppedAt && active.durationSeconds) { const session = {
    id: active.id, mode: active.mode, startedAt: active.startedAt, endedAt: active.stoppedAt,
    durationSeconds: active.durationSeconds, ...(active.targetSeconds ? { targetSeconds: active.targetSeconds } : {}),
    ...(active.mode === 'timer' && active.durationSeconds >= (active.targetSeconds ?? Infinity) ? { automatic: true } : {}),
  }; state.pending = [...(state.pending ?? []).filter(value => value.id !== session.id), session]; }
  attachQuickTimer(draft);
}
export function attachQuickTimer(draft: WorkspaceDocument) {
  const state = draft.quickTimer, item = state?.itemId ? draft.items[state.itemId] : undefined;
  if (!state?.pending || !item || item.deletedAt) return;
  for (const session of state.pending) addTimerActualTime(item, session);
  item.revision += 1; item.updatedAt = new Date().toISOString();
  delete state.pending;
}
export function QuickTimerDialog({ workspace, open, onClose, commit }: { workspace: WorkspaceDocument; open: boolean; onClose: () => void; commit: Commit }) {
  const [query, setQuery] = useState('');
  const [resultLimit, setResultLimit] = useState(20);
  const matches = Object.values(workspace.items).filter(entry => !entry.deletedAt && entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const ru = workspace.calendarPreferences.language === 'ru';
  const state = workspace.quickTimer;
  const item = state?.itemId ? workspace.items[state.itemId] : undefined;
  useEffect(() => {
    const check = () => {
      const timer = state?.active;
      if (!timer || timer.mode !== 'timer' || timer.stoppedAt || !timer.targetSeconds) return;
      const end = Date.parse(timer.startedAt) + timer.targetSeconds * 1000;
      if (end > Date.now()) return;
      commit('Record quick timer completion', draft => storeQuickTimer(draft, { ...timer, stoppedAt: new Date(end).toISOString(), durationSeconds: timer.targetSeconds! }));
    };
    if (!open) check();
    const timer = window.setInterval(() => { if (!open) check(); }, 1000);
    return () => window.clearInterval(timer);
  }, [state?.active, open, commit]);
  const choose = (id: string) => commit('Attach quick timer', draft => {
    draft.quickTimer ??= {};
    if (id) draft.quickTimer.itemId = id; else delete draft.quickTimer.itemId;
    attachQuickTimer(draft);
  });
  return <ResponsiveDialog open={open} onOpenChange={value => { if (!value) onClose(); }} title={ru ? 'Таймер и секундомер' : 'Timer and stopwatch'}>
    <Input aria-label={ru ? 'Поиск item' : 'Search item'} placeholder={ru ? 'Найти или создать item' : 'Find or create item'} value={query} onChange={event => { setQuery(event.target.value); setResultLimit(20); }} />
    {query.trim() && <section className="quick-timer-search" aria-label={ru ? 'Результаты поиска' : 'Search results'}>
      <small role="status">{ru ? `Найдено: ${matches.length}` : `Found: ${matches.length}`}</small>
      {matches.slice(0, resultLimit).map(entry => <Button key={entry.id} variant="secondary" onClick={() => { choose(entry.id); setQuery(''); }}>{entry.title}</Button>)}
      {matches.length > resultLimit && <Button variant="ghost" onClick={() => setResultLimit(value => value + 20)}>{ru ? 'Показать ещё' : 'Show more'}</Button>}
    </section>}
    <Select aria-label={ru ? 'Привязать к item' : 'Attach to item'} value={item?.id ?? ''} onChange={event => choose(event.target.value)}>
      <option value="">{ru ? 'Без привязки' : 'Unattached'}</option>
      {Object.values(workspace.items).filter(entry => !entry.deletedAt && (entry.id === item?.id || entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
    </Select>
    <Button disabled={!query.trim()} onClick={() => {
      const created = createItem(query.trim());
      commit('Create timer item', draft => { draft.items[created.id] = created; draft.quickTimer ??= {}; draft.quickTimer.itemId = created.id; attachQuickTimer(draft); });
      setQuery('');
    }}>{ru ? 'Создать item' : 'Create item'}</Button>
    {open && <QuickItemTimer expanded activeTimer={state?.active} timerTitle={item?.title ?? 'Universal'} defaultDurationSeconds={item?.schedule?.estimatedDuration ? durationToMs(item.schedule.estimatedDuration) / 1000 : 600} onActiveTimerChange={active => { if (commit('Save quick timer', draft => storeQuickTimer(draft, active)) === false) throw new Error(ru ? 'Не удалось сохранить отсчёт' : 'Could not save timer session'); }} />}
    <p>{state?.pending ? (ru ? 'Результат сохранён. Выберите item для записи в историю.' : 'Result saved. Select an item to add it to history.') : (ru ? 'Отсчёт сохраняется при закрытии. После остановки результат записывается в выбранный item.' : 'Closing preserves the session. Stopping records the result in the selected item.')}</p>
  </ResponsiveDialog>;
}
