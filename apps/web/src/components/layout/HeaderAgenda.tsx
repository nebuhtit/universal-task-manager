import { useEffect, useMemo, useRef } from 'react';
import { agendaWidgetRequest, hasNativeAgendaWidget, needsAgendaWidgetSync } from '../../services/nativeAgendaWidget';
import { agendaInput, calculateAgendaInWorker } from '../../services/agendaWorker';
import type { WorkspaceDocument } from '@utm/core';
import { useWorkspaceNow } from '../../hooks/useClock';
import { AgendaTitle, agendaPlainText } from './AgendaTitle';
import { agendaMoment } from './agendaMoment';
import { recordDiagnostic } from '../../services/diagnostics';
import { useHeaderAgenda } from '../../hooks/useHeaderAgenda';
import { formatAgendaRemaining } from './headerAgendaModel';

export function HeaderAgenda({ workspace }: { workspace?: WorkspaceDocument }) {
  const widgetSent = useRef('');
  const input = useMemo(() => workspace && hasNativeAgendaWidget() ? agendaInput(workspace) : undefined, [workspace]);
  useEffect(() => {
    if (!input) return;
    let disposed = false;
    let generation = 0;
    let calculation: AbortController | undefined;
    const sync = (force = false) => {
      const request = ++generation;
      calculation?.abort();
      const controller = new AbortController(); calculation = controller;
      void agendaWidgetRequest('status').then(async status => {
      if (!disposed && status.enabled) {
        if (request !== generation) return;
        const calculationStartedAt = performance.now();
        const snapshot = await calculateAgendaInWorker(input.workspace, Date.now(), controller.signal);
        const calculationMs = Math.round(performance.now() - calculationStartedAt);
        if (disposed || request !== generation) return;
        const { at: _at, ...firstStage } = snapshot.entries[0] ?? {};
        const signature = JSON.stringify([input.workspace.workspaceId, firstStage, snapshot.entries.slice(1), Math.floor(snapshot.generatedAt / 1800)]);
        if (!needsAgendaWidgetSync(status, signature, widgetSent.current, force)) return;
        const transferStartedAt = performance.now();
        return agendaWidgetRequest('sync', snapshot).then(reply => {
          if (disposed || request !== generation) return;
          if (!reply.enabled || reply.snapshotReady === false) throw new Error('Widget snapshot was not accepted');
          widgetSent.current = signature;
          recordDiagnostic({ kind: 'result', operation: 'Agenda widget', message: 'Widget snapshot updated', durationMs: Math.round(performance.now() - transferStartedAt), details: JSON.stringify({ version: snapshot.version, generatedAt: snapshot.generatedAt, nextTransition: snapshot.nextStageAt, expires: snapshot.expires, calculationMs, transferMs: Math.round(performance.now() - transferStartedAt) }) });
        });
      }
    }).catch(reason => { if (!disposed && request === generation && !controller.signal.aborted) recordDiagnostic({ kind: 'error', operation: 'Agenda widget', message: 'Widget snapshot transfer failed', details: JSON.stringify({ code: reason instanceof Error ? reason.message : 'native_bridge_failure' }) }); }); };
    const visible = () => { if (document.visibilityState === 'visible') sync(true); };
    const changed = () => { widgetSent.current = ''; sync(true); };
    sync();
    const refresh = window.setInterval(visible, 30 * 60_000);
    window.addEventListener('utm-agenda-widget-change', changed);
    document.addEventListener('visibilitychange', visible);
    return () => { disposed = true; calculation?.abort(); window.clearInterval(refresh); window.removeEventListener('utm-agenda-widget-change', changed); document.removeEventListener('visibilitychange', visible); };
    // The key covers agenda inputs only; backup/sync timestamps do not restart work.
  }, [input?.key]);
  const now = useWorkspaceNow(workspace).getTime();
  const agenda = useHeaderAgenda(workspace, now);
  const ru = workspace?.calendarPreferences.language === 'ru';
  const current = agenda?.current, next = agenda?.next;
  const moment = next && workspace ? agendaMoment(next.at, now, workspace.calendarPreferences.timezone) : undefined;
  return <section className="header-agenda" aria-label={ru ? 'Сейчас и далее' : 'Now and next'}>
    {current && <span className="header-agenda-part"><span className="header-agenda-title" title={agendaPlainText([current.title, ...(agenda?.concurrent ?? []).map(entry => entry.title)].join(' · '), ru)}><AgendaTitle text={current.title} ru={ru} />{agenda?.concurrent[0] && <> (<AgendaTitle text={agenda.concurrent[0].title} ru={ru} />{agenda.additional > 1 ? ` +${agenda.additional - 1}` : ''})</>}</span></span>}
    {current && next && <span aria-hidden="true">→</span>}
    {next && <span className="header-agenda-part"><span>{next.kind === 'due' ? (ru ? 'до due' : 'due in') : (ru ? 'через' : 'in')} {formatAgendaRemaining(next.at - now, ru ? 'ru' : 'en')} ·</span><span className="header-agenda-title" title={agendaPlainText(next.title, ru)}><AgendaTitle text={next.title} ru={ru} /></span>{moment && <span className="header-agenda-moment">· {moment.tomorrow && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label={ru ? 'Завтра' : 'Tomorrow'}><path d="m9 18 6-6-6-6" /></svg>}{moment.text}</span>}</span>}
    {!agenda && <span className="header-agenda-title">{ru ? 'Загрузка статуса…' : 'Loading status…'}</span>}
    {agenda && !current && !next && <span className="header-agenda-title">{ru ? 'Нет ближайших событий и сроков' : 'No upcoming events or deadlines'}</span>}
  </section>;
}
