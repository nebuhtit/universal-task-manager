import { useRef } from 'react';
import { itemDeletionTime, type WorkspaceDocument } from '@utm/core';
import { useWorkspaceNow } from '../../hooks/useClock';
import { UserDataText } from '../../i18n-react';
import { formatAgendaRemaining, selectHeaderAgenda, type HeaderAgenda as Agenda } from './headerAgendaModel';

export function HeaderAgenda({ workspace }: { workspace?: WorkspaceDocument }) {
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
    {current && <span className="header-agenda-part"><span className="header-agenda-title" title={[current.title, ...(agenda?.concurrent ?? []).map(entry => entry.title)].join(' · ')}><UserDataText>{current.title}</UserDataText>{agenda?.concurrent[0] && <> (<UserDataText>{agenda.concurrent[0].title}</UserDataText>{agenda.additional > 1 ? ` +${agenda.additional - 1}` : ''})</>}</span></span>}
    {current && next && <span aria-hidden="true">→</span>}
    {next && <span className="header-agenda-part"><span>{next.kind === 'due' ? (ru ? 'до due' : 'due in') : (ru ? 'через' : 'in')} {formatAgendaRemaining(next.at - now, ru ? 'ru' : 'en')} ·</span><span className="header-agenda-title" title={next.title}><UserDataText>{next.title}</UserDataText></span></span>}
    {!current && !next && <span className="header-agenda-title">{ru ? 'Нет ближайших событий и сроков' : 'No upcoming events or deadlines'}</span>}
  </section>;
}
