import { useEffect, useRef } from 'react';
import { agendaWidgetRequest, agendaWidgetSnapshot, hasNativeAgendaWidget } from '../../services/nativeAgendaWidget';
import { itemDeletionTime, type WorkspaceDocument } from '@utm/core';
import { useWorkspaceNow } from '../../hooks/useClock';
import { AgendaTitle, agendaPlainText } from './AgendaTitle';
import { agendaMoment } from './agendaMoment';
import { recordDiagnostic } from '../../services/diagnostics';
import { formatAgendaRemaining, selectHeaderAgenda, type HeaderAgenda as Agenda } from './headerAgendaModel';

export function HeaderAgenda({ workspace }: { workspace?: WorkspaceDocument }) {
  const widgetSent = useRef('');
  useEffect(() => {
    if (!workspace || !hasNativeAgendaWidget()) return;
    let disposed = false;
    const sync = () => { void agendaWidgetRequest('status').then(status => {
      if (!disposed && status.enabled) {
        const snapshot = agendaWidgetSnapshot(workspace);
        const { at: _at, ...firstStage } = snapshot.entries[0] ?? {};
        const signature = JSON.stringify([workspace.workspaceId, firstStage, snapshot.entries.slice(1), Math.floor(snapshot.generatedAt / 1800)]);
        if (signature === widgetSent.current) return;
        return agendaWidgetRequest('sync', snapshot).then(() => {
          widgetSent.current = signature;
          recordDiagnostic({ kind: 'result', operation: 'Agenda widget', message: 'Widget snapshot updated', details: JSON.stringify({ version: snapshot.version, generatedAt: snapshot.generatedAt, nextTransition: snapshot.nextStageAt, expires: snapshot.expires }) });
        });
      }
    }).catch(() => undefined); };
    const visible = () => { if (document.visibilityState === 'visible') sync(); };
    sync();
    const refresh = window.setInterval(visible, 30 * 60_000);
    window.addEventListener('utm-agenda-widget-change', sync);
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; window.clearInterval(refresh); window.removeEventListener('utm-agenda-widget-change', sync); document.removeEventListener('visibilitychange', visible); };
  }, [workspace]);
  const now = useWorkspaceNow(workspace).getTime();
  const cache = useRef<{ workspace: WorkspaceDocument; at: number; agenda: Agenda } | undefined>(undefined);
  const deletedFromCache = workspace && [cache.current?.agenda.current, ...(cache.current?.agenda.concurrent ?? []), cache.current?.agenda.next].some(entry => {
    if (!entry) return false;
    const id = entry.id.split('/')[0]!;
    const item = workspace.items[id];
    return Boolean(workspace.tombstones[id] || (item && itemDeletionTime(workspace, item)));
  });
  if (workspace && (!cache.current || cache.current.workspace !== workspace || deletedFromCache || now < cache.current.at || now >= cache.current.agenda.validUntil)) {
    cache.current = { workspace, at: now, agenda: selectHeaderAgenda(workspace, now) };
  }
  const agenda = workspace ? cache.current?.agenda : undefined;
  const ru = workspace?.calendarPreferences.language === 'ru';
  const current = agenda?.current, next = agenda?.next;
  const moment = next && workspace ? agendaMoment(next.at, now, workspace.calendarPreferences.timezone) : undefined;
  return <section className="header-agenda" aria-label={ru ? 'Сейчас и далее' : 'Now and next'}>
    {current && <span className="header-agenda-part"><span className="header-agenda-title" title={agendaPlainText([current.title, ...(agenda?.concurrent ?? []).map(entry => entry.title)].join(' · '), ru)}><AgendaTitle text={current.title} ru={ru} />{agenda?.concurrent[0] && <> (<AgendaTitle text={agenda.concurrent[0].title} ru={ru} />{agenda.additional > 1 ? ` +${agenda.additional - 1}` : ''})</>}</span></span>}
    {current && next && <span aria-hidden="true">→</span>}
    {next && <span className="header-agenda-part"><span>{next.kind === 'due' ? (ru ? 'до due' : 'due in') : (ru ? 'через' : 'in')} {formatAgendaRemaining(next.at - now, ru ? 'ru' : 'en')} ·</span><span className="header-agenda-title" title={agendaPlainText(next.title, ru)}><AgendaTitle text={next.title} ru={ru} /></span>{moment && <span className="header-agenda-moment">· {moment.tomorrow && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label={ru ? 'Завтра' : 'Tomorrow'}><path d="m9 18 6-6-6-6" /></svg>}{moment.text}</span>}</span>}
    {!current && !next && <span className="header-agenda-title">{ru ? 'Нет ближайших событий и сроков' : 'No upcoming events or deadlines'}</span>}
  </section>;
}
