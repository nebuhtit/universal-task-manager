import { useEffect, useRef } from 'react';
import { agendaWidgetRequest, agendaWidgetSnapshot, hasNativeAgendaWidget } from '../../services/nativeAgendaWidget';
import { itemDeletionTime, type WorkspaceDocument } from '@utm/core';
import { useWorkspaceNow } from '../../hooks/useClock';
import { AgendaTitle } from './AgendaTitle';
import { formatAgendaRemaining, selectHeaderAgenda, type HeaderAgenda as Agenda } from './headerAgendaModel';

export function HeaderAgenda({ workspace }: { workspace?: WorkspaceDocument }) {
  useEffect(() => {
    if (!workspace || !hasNativeAgendaWidget()) return;
    let disposed = false;
    const sync = () => { void agendaWidgetRequest('status').then(status => {
      if (!disposed && status.enabled) return agendaWidgetRequest('sync', agendaWidgetSnapshot(workspace));
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
  return <section className="header-agenda" aria-label={ru ? 'Сейчас и далее' : 'Now and next'}>
    {current && <span className="header-agenda-part"><span className="header-agenda-title" title={[current.title, ...(agenda?.concurrent ?? []).map(entry => entry.title)].join(' · ')}><AgendaTitle text={current.title} ru={ru} />{agenda?.concurrent[0] && <> (<AgendaTitle text={agenda.concurrent[0].title} ru={ru} />{agenda.additional > 1 ? ` +${agenda.additional - 1}` : ''})</>}</span></span>}
    {current && next && <span aria-hidden="true">→</span>}
    {next && <span className="header-agenda-part"><span>{next.kind === 'due' ? (ru ? 'до due' : 'due in') : (ru ? 'через' : 'in')} {formatAgendaRemaining(next.at - now, ru ? 'ru' : 'en')} ·</span><span className="header-agenda-title" title={next.title}><AgendaTitle text={next.title} ru={ru} /></span></span>}
    {!current && !next && <span className="header-agenda-title">{ru ? 'Нет ближайших событий и сроков' : 'No upcoming events or deadlines'}</span>}
  </section>;
}
