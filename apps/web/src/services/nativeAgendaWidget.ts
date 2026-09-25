import type { WorkspaceDocument } from '@utm/core';
import { selectHeaderAgenda } from '../components/layout/headerAgendaModel';

type Reply = { enabled: boolean };
const bridge = () => typeof window === 'undefined' ? undefined : (window as typeof window & { webkit?: { messageHandlers?: { utmNativeAgenda?: { postMessage: (value: unknown) => Promise<Reply> } } } }).webkit?.messageHandlers?.utmNativeAgenda;
export const hasNativeAgendaWidget = () => Boolean(bridge());
export async function agendaWidgetRequest(kind: 'status' | 'enable' | 'disable' | 'sync', payload?: unknown) {
  const handler = bridge();
  if (!handler) throw new Error('Widget unavailable');
  return handler.postMessage({ kind, payload });
}

/** Minimal read-only projection. No passwords, item objects, or Google tokens. */
export function agendaWidgetSnapshot(workspace: WorkspaceDocument, now = Date.now()) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const entries: Array<{ at: number; current: string; title: string; target: number | null; label: string }> = [];
  const until = now + 48 * 3600_000;
  let at = now;
  for (let index = 0; index < 128 && at < until; index++) {
    const agenda = selectHeaderAgenda(workspace, at);
    const current = agenda.current ? agenda.current.title + (agenda.concurrent[0] ? ` (${agenda.concurrent[0].title}${agenda.additional > 1 ? ` +${agenda.additional - 1}` : ''})` : '') : '';
    entries.push({ at: at / 1000, current: current.slice(0, 160), title: (agenda.next?.title ?? (ru ? 'Нет ближайших событий' : 'No upcoming events')).slice(0, 160), target: agenda.next ? agenda.next.at / 1000 : null, label: agenda.next?.kind === 'due' ? (ru ? 'До срока' : 'Due in') : (ru ? 'Через' : 'In') });
    if (!Number.isFinite(agenda.validUntil)) { at = until; break; }
    at = Math.max(at + 1, agenda.validUntil);
  }
  return { entries, expires: Math.min(at, until) / 1000, refreshLabel: ru ? 'Откройте Universal для обновления' : 'Open Universal to refresh' };
}
