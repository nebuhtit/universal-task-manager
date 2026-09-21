import { type UniversalItem, type EventProgramBlock } from './types.js';

export function validateEventProgram(item: UniversalItem): void {
  const blocks = item.eventProgram?.blocks ?? [];
  if (!blocks.length) return;
  if (!Number.isFinite(Date.parse(item.schedule?.startAt ?? ''))) throw new Error('The program requires Event opens.');
  const ids = new Set<string>();
  for (const block of blocks) {
    if (!block.id || ids.has(block.id)) throw new Error('Program block IDs must be unique.');
    ids.add(block.id);
    if (!block.title.trim()) throw new Error('Give every program block a title.');
    if (!Number.isSafeInteger(block.startOffsetSeconds) || !Number.isSafeInteger(block.endOffsetSeconds) || block.startOffsetSeconds < 0 || block.endOffsetSeconds <= block.startOffsetSeconds) throw new Error('Every program block must end after its start.');
  }
}

export function syncEventProgramScript(item: UniversalItem, language = 'en'): void {
  const existing = item.scripts?.find((script) => script.managedBy === 'event_program');
  const others = (item.scripts ?? []).filter((script) => script.managedBy !== 'event_program');
  if (!item.eventProgram?.blocks.length) {
    delete item.eventProgram;
    if (others.length) item.scripts = others; else delete item.scripts;
    return;
  }
  validateEventProgram(item);
  let key = existing?.key ?? 'event_program';
  for (let suffix = 2; others.some((script) => script.key === key); suffix += 1) key = `event_program_${suffix}`;
  let id = existing?.id ?? `event-program:${item.id}`;
  while (others.some((script) => script.id === id)) id += ':program';
  item.scripts = [...others, { id, key, label: language === 'ru' ? 'Программа мероприятия' : 'Event program', source: `eventProgramStatus(${JSON.stringify(language)})`, resultKind: 'text', managedBy: 'event_program' }];
}

export function programOverflow(item: UniversalItem): EventProgramBlock[] {
  const length = (Date.parse(item.schedule?.endAt ?? '') - Date.parse(item.schedule?.startAt ?? '')) / 1000;
  return Number.isFinite(length) ? (item.eventProgram?.blocks ?? []).filter((block) => block.endOffsetSeconds > length) : [];
}

export function trimEventProgram(item: UniversalItem): UniversalItem {
  const length = Math.floor((Date.parse(item.schedule?.endAt ?? '') - Date.parse(item.schedule?.startAt ?? '')) / 1000);
  if (!Number.isFinite(length) || length <= 0) throw new Error('Event ends must be after Event opens.');
  return { ...item, eventProgram: { blocks: (item.eventProgram?.blocks ?? []).filter((block) => block.startOffsetSeconds < length).map((block) => ({ ...block, endOffsetSeconds: Math.min(block.endOffsetSeconds, length) })) } };
}

export function eventProgramStatus(item: UniversalItem, now: Date, language = 'en'): string {
  const ru = language === 'ru';
  const blocks = item.eventProgram?.blocks ?? [];
  const origin = Date.parse(item.schedule?.startAt ?? '');
  if (!blocks.length || !Number.isFinite(origin)) return '';
  const seconds = (now.getTime() - origin) / 1000;
  const ordered = [...blocks].sort((a, b) => a.startOffsetSeconds - b.startOffsetSeconds);
  const current = ordered.filter((block) => block.startOffsetSeconds <= seconds && seconds < block.endOffsetSeconds);
  const nextBlock = ordered.find((block) => block.startOffsetSeconds > seconds);
  if (!nextBlock && !current.length) return ru ? 'Завершена' : 'Finished';
  const next = nextBlock?.startOffsetSeconds ?? Math.min(...current.map((block) => block.endOffsetSeconds));
  const remaining = Math.max(0, Math.ceil(next - seconds));
  const h = Math.floor(remaining / 3600), m = Math.floor(remaining % 3600 / 60), s = remaining % 60;
  const duration = h ? `${h}${ru ? 'ч' : 'h'} ${m}${ru ? 'мин' : 'm'}` : m ? `${m}${ru ? 'мин' : 'm'} ${s}${ru ? 'с' : 's'}` : `${s}${ru ? 'с' : 's'}`;
  const currentTitle = current.map((block) => block.title).join(' · ');
  if (current.length && nextBlock) return `${currentTitle} → ${nextBlock.title} ${ru ? `начнётся через ${duration}` : `starts in ${duration}`}`;
  if (current.length) return `${currentTitle} · ${ru ? `до конца ${duration}` : `${duration} left`}`;
  return `→ ${nextBlock!.title} ${ru ? `начнётся через ${duration}` : `starts in ${duration}`}`;
}
