import type { WorkspaceDocument } from '@utm/core';
import { selectHeaderAgenda } from '../components/layout/headerAgendaModel';
import { agendaMoment, nextAgendaMidnight } from '../components/layout/agendaMoment';

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
  const entries: Array<{ at: number; current: string; title: string; target: number | null; label: string; moment: string; tomorrow: boolean }> = [];
  const until = now + 48 * 3600_000;
  let at = now;
  for (let index = 0; index < 128 && at < until; index++) {
    const agenda = selectHeaderAgenda(workspace, at);
    const current = agenda.current ? agenda.current.title + (agenda.concurrent[0] ? ` (${agenda.concurrent[0].title}${agenda.additional > 1 ? ` +${agenda.additional - 1}` : ''})` : '') : '';
    const moment = agenda.next ? agendaMoment(agenda.next.at, at, workspace.calendarPreferences.timezone) : { text: '', tomorrow: false };
    entries.push({ at: at / 1000, current: current.slice(0, 160), title: (agenda.next?.title ?? (ru ? 'Нет ближайших событий' : 'No upcoming events')).slice(0, 160), target: agenda.next ? agenda.next.at / 1000 : null, label: agenda.next?.kind === 'due' ? (ru ? 'До срока' : 'Due in') : (ru ? 'Через' : 'In'), moment: moment.text, tomorrow: moment.tomorrow });
    if (!Number.isFinite(agenda.validUntil) && !agenda.next) { at = until; break; }
    at = Math.max(at + 1, Math.min(agenda.validUntil, nextAgendaMidnight(at, workspace.calendarPreferences.timezone)));
  }
  const expires = Math.min(at, until) / 1000;
  const thresholds = entries.flatMap((entry, index) => {
    const boundary = entry.target === null ? 0 : entry.target - 600 + 0.001;
    return boundary > entry.at && boundary < (entries[index + 1]?.at ?? expires) ? [{ ...entry, at: boundary }] : [];
  });
  // Real stage entries take precedence over presentation-only boundaries.
  const timeline = [...new Map([...thresholds, ...entries].map(entry => [entry.at, entry])).values()].sort((a, b) => a.at - b.at);
  return { version: 2, generatedAt: now / 1000, entries: timeline.slice(0, 128), expires: Math.min(expires, timeline[128]?.at ?? expires), refreshLabel: ru ? 'Откройте Universal для обновления' : 'Open Universal to refresh' };
}
