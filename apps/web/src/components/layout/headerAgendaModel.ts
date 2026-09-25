import { buildRecurrenceRule, createOccurrence, durationToMs, itemDeletionTime, recurrenceAnchor, type UniversalItem, type WorkspaceDocument } from '@utm/core';

export type AgendaEntry = { id: string; title: string; at: number; kind: 'event' | 'program' | 'due' };
export const TRAVEL_TO = '[[travel-to]] ';
export const TRAVEL_ROAD = '[[travel-road]] ';
export const TRAVEL_BACK_TO = '[[travel-back-to]] ';
export type HeaderAgenda = { current?: AgendaEntry; concurrent: AgendaEntry[]; additional: number; next?: AgendaEntry; validUntil: number };
const timestamp = (value?: string) => Date.parse(value ?? '');
const stable = (a: AgendaEntry, b: AgendaEntry) => a.id.localeCompare(b.id);

/** Read-only projection: stored exceptions replace virtual cycles, including deleted/closed ones. */
function agendaItems(workspace: WorkspaceDocument, now: number): UniversalItem[] {
  const stored = Object.values(workspace.items);
  const eligible = (item: UniversalItem) => item.state === 'open' && !itemDeletionTime(workspace, item);
  const result = stored.filter(item => item.role !== 'series_template' && eligible(item));
  for (const series of stored) {
    if (series.role !== 'series_template' || !eligible(series) || !series.recurrence || !recurrenceAnchor(series)) continue;
    const origin = new Date(recurrenceAnchor(series)!);
    const sample = createOccurrence(series, origin, 0);
    // Include long-running cycles and due offsets, not just yesterday's anchor.
    const offsets = [timestamp(sample.schedule?.endAt), timestamp(sample.schedule?.dueAt), ...(sample.eventProgram?.blocks ?? []).map(block => origin.getTime() + block.endOffsetSeconds * 1000)];
    const lookback = Math.max(0, ...offsets.filter(Number.isFinite).map(at => at - origin.getTime()));
    const overrides = new Set(stored.filter(item => item.occurrence?.seriesId === series.id).map(item => item.occurrence!.recurrenceId));
    const rule = buildRecurrenceRule(series);
    const append = (anchor: Date) => {
      if (!overrides.has(anchor.toISOString())) {
        const item = createOccurrence(series, anchor, 0);
        if (eligible(item)) result.push(item);
      }
    };
    for (const anchor of rule.between(new Date(now - lookback), new Date(now), true)) append(anchor);
    let next = rule.after(new Date(now));
    // Exceptions may move or close arbitrarily many upcoming cycles.
    while (next && (overrides.has(next.toISOString()) || !eligible(createOccurrence(series, next, 0)))) next = rule.after(next);
    if (next) append(next);
  }
  return result;
}

export function selectHeaderAgenda(workspace: WorkspaceDocument, now: number): HeaderAgenda {
  const active: { entry: AgendaEntry; duration: number; started: number }[] = [];
  const future: AgendaEntry[] = [];
  const dueMode = workspace.calendarPreferences.appearance.headerDueMode ?? 'timed';
  let validUntil = Infinity;
  const boundary = (at: number) => { if (at > now) validUntil = Math.min(validUntil, at); };
  for (const item of agendaItems(workspace, now)) {
    const sleepId = workspace.calendarPreferences.timeline?.sleepItemId;
    if (sleepId && (item.id === sleepId || item.occurrence?.seriesId === sleepId)) continue;
    const start = timestamp(item.schedule?.startAt), end = timestamp(item.schedule?.endAt);
    const timed = !item.schedule?.plannedDate && !item.schedule?.allDay;
    const event: AgendaEntry = { id: item.id, title: item.title, at: start, kind: 'event' };
    const due = timestamp(item.schedule?.dueAt);
    if (due > now && dueMode !== 'off' && (dueMode === 'all' || (!item.schedule?.dueDateOnly && !/^\d{4}-\d{2}-\d{2}$/.test(item.schedule?.dueAt ?? '')))) future.push({ ...event, at: due, kind: 'due' });
    boundary(due);
    if (!timed) continue;
    boundary(start); boundary(end);
    let travel = 0;
    try { travel = durationToMs(item.schedule?.travelDuration ?? 'PT0S'); } catch { /* Invalid legacy duration is not an agenda boundary. */ }
    if (Number.isFinite(start) && Number.isFinite(travel) && travel > 0) {
      const departure = start - travel;
      const entry: AgendaEntry = { ...event, at: departure, title: `${TRAVEL_TO}${item.title}` };
      boundary(departure);
      if (departure > now) future.push(entry);
      else if (now < start) active.push({ entry: { ...entry, title: `${TRAVEL_ROAD}${item.title}` }, duration: travel, started: departure });
    }
    let travelBack = 0;
    try { travelBack = durationToMs(item.schedule?.travelBackDuration ?? 'PT0S'); } catch { /* Invalid legacy duration. */ }
    if (Number.isFinite(end) && Number.isFinite(travelBack) && travelBack > 0) {
      boundary(end + travelBack);
      if (end > now) future.push({ ...event, at: end, title: `${TRAVEL_BACK_TO}${item.title}` });
    }
    if (start > now) future.push(event);
    const blocks = (item.eventProgram?.blocks ?? []).map(block => ({ id: `${item.id}/${block.id}`, title: block.title, at: start + block.startOffsetSeconds * 1000, end: start + block.endOffsetSeconds * 1000, kind: 'program' as const }));
    for (const block of blocks) {
      boundary(block.at); boundary(block.end);
      if (block.at > now && (!Number.isFinite(end) || block.at < end)) future.push(block);
    }
    if (start <= now && now < end) {
      const currentBlocks = blocks.filter(block => block.at <= now && now < block.end).sort((a, b) => b.at - a.at || stable(a, b));
      active.push({ entry: currentBlocks[0] ?? event, duration: end - start, started: start });
      for (const block of currentBlocks.slice(1)) active.push({ entry: block, duration: block.end - block.at, started: block.at });
    }
  }
  active.sort((a, b) => b.duration - a.duration || a.started - b.started || stable(a.entry, b.entry));
  const rank = { due: 0, program: 1, event: 2 };
  future.sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind] || stable(a, b));
  return { ...(active[0] ? { current: active[0].entry } : {}), concurrent: active.slice(1).map(value => value.entry), additional: Math.max(0, active.length - 1), ...(future[0] ? { next: future[0] } : {}), validUntil };
}

export function formatAgendaRemaining(milliseconds: number, language: string): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const [d, h, m, s] = language === 'ru' ? ['д', 'ч', 'мин', 'с'] : ['d', 'h', 'min', 's'];
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} ${d} ${Math.floor(seconds % 86400 / 3600)} ${h}`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} ${h} ${Math.floor(seconds % 3600 / 60)} ${m}`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} ${m} ${seconds % 60} ${s}`;
  return `${seconds} ${s}`;
}
