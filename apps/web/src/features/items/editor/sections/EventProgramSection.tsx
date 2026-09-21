import { useRef, useState } from 'react';
import { createId, eventProgramStatus, programOverflow, syncEventProgramScript, trimEventProgram, type UniversalItem } from '@utm/core';
import { Button, Disclosure, Field, Input } from '../../../../components/ui/primitives';
import { programDateInput, programDateInstant } from './programDates';
import './event-program.css';

export function EventProgramSection({ item, onChange, language, now, occurrences = [], onOpenOccurrence }: { item: UniversalItem; onChange: (item: UniversalItem) => void; language: string; now: Date; occurrences?: UniversalItem[]; onOpenOccurrence?: ((item: UniversalItem) => void) | undefined }) {
  const ru = language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const [error, setError] = useState('');
  const autoEnd = useRef(!item.schedule?.endAt);
  const autoStart = useRef(!item.schedule?.startAt);
  const autoOrigin = useRef<number>(NaN);
  const blocks = item.eventProgram?.blocks ?? [];
  const zone = item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const origin = Date.parse(item.schedule?.startAt ?? '');
  const update = (nextBlocks: typeof blocks) => {
    const next = { ...item, eventProgram: { blocks: nextBlocks } };
    const previousEnd = origin + (blocks.length ? Math.max(...blocks.map((block) => block.endOffsetSeconds)) : 0) * 1000;
    if (autoEnd.current && (!item.schedule?.endAt || Date.parse(item.schedule.endAt) === previousEnd) && nextBlocks.length && nextBlocks.every((block) => Number.isFinite(block.endOffsetSeconds))) next.schedule = { ...item.schedule!, endAt: new Date(origin + Math.max(...nextBlocks.map((block) => block.endOffsetSeconds)) * 1000).toISOString() };
    if (autoStart.current && autoOrigin.current === origin && nextBlocks.length && nextBlocks.every((block) => Number.isFinite(block.startOffsetSeconds))) {
      const shift = Math.min(...nextBlocks.map((block) => block.startOffsetSeconds));
      autoOrigin.current = origin + shift * 1000;
      next.schedule = { ...next.schedule!, startAt: new Date(autoOrigin.current).toISOString() };
      next.eventProgram = { blocks: nextBlocks.map((block) => ({ ...block, startOffsetSeconds: block.startOffsetSeconds - shift, endOffsetSeconds: block.endOffsetSeconds - shift })) };
    }
    onChange(next); setError('');
  };
  const add = () => {
    const base = Number.isFinite(origin) ? origin : Math.floor(now.getTime() / 60000) * 60000;
    const start = blocks.at(-1)?.endOffsetSeconds ?? 0;
    const end = start + 1800;
    const nextBlocks = [...blocks, { id: createId(), title: '', startOffsetSeconds: start, endOffsetSeconds: end }];
    if (!Number.isFinite(origin)) { autoOrigin.current = base; onChange({ ...item, schedule: { ...item.schedule, timezone: zone, startAt: new Date(base).toISOString(), ...(!item.schedule?.endAt ? { endAt: new Date(base + end * 1000).toISOString() } : {}) }, eventProgram: { blocks: nextBlocks } }); }
    else update(nextBlocks);
  };
  const apply = () => {
    try {
      if (programOverflow(item).length) throw new Error(t('Extend the event or adjust blocks outside its boundaries.', 'Расширьте событие или исправьте блоки за его границами.'));
      const next = { ...item }; syncEventProgramScript(next, language); onChange(next); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const outside = programOverflow(item).length > 0 || blocks.some((block) => block.startOffsetSeconds < 0);
  const extend = () => {
    if (!blocks.length || !blocks.every((block) => Number.isFinite(block.startOffsetSeconds) && Number.isFinite(block.endOffsetSeconds))) return;
    const shift = Math.min(0, ...blocks.map((block) => block.startOffsetSeconds));
    const end = Math.max(...blocks.map((block) => block.endOffsetSeconds));
    autoEnd.current = false;
    autoStart.current = false;
    onChange({ ...item, schedule: { ...item.schedule!, startAt: new Date(origin + shift * 1000).toISOString(), endAt: new Date(Math.max(Date.parse(item.schedule?.endAt ?? '') || 0, origin + end * 1000)).toISOString() }, eventProgram: { blocks: blocks.map((block) => ({ ...block, startOffsetSeconds: block.startOffsetSeconds - shift, endOffsetSeconds: block.endOffsetSeconds - shift })) } });
  };
  return <Disclosure uiKey={`item-program:${item.id}`} persist={false} summary={`${t('Event program', 'Программа мероприятия')}${blocks.length ? ` · ${blocks.length}` : ''}`} className="event-program">
    <small>{zone}</small>
    {item.role === 'series_template' && <small>{t('This program is inherited by new occurrences.', 'Эту программу наследуют новые повторения.')}</small>}
    {onOpenOccurrence && occurrences.length > 0 && <Disclosure uiKey={`program-occurrences:${item.id}`} persist={false} summary={t('Program for an individual occurrence', 'Программа отдельного повторения')}><div className="program-actions">{occurrences.map((entry) => <Button key={entry.id} onClick={() => onOpenOccurrence(entry)}>{programDateInput(Date.parse(entry.schedule?.startAt ?? ''), zone).replace('T', ' ') || entry.title}</Button>)}</div></Disclosure>}
    {item.schedule?.allDay && <p>{t('Switch off All day to add program blocks.', 'Выключите «Весь день», чтобы добавить блоки программы.')}</p>}
    {blocks.map((block, index) => <div className="program-block" key={block.id}>
      <Field label={t('Block title', 'Название блока')}><Input aria-label={`${t('Block title', 'Название блока')} ${index + 1}`} value={block.title} onChange={(event) => update(blocks.map((entry) => entry.id === block.id ? { ...entry, title: event.target.value } : entry))} /></Field>
      <div className="program-times">{(['startOffsetSeconds', 'endOffsetSeconds'] as const).map((key, position) => <Field key={key} label={position ? t('End', 'Окончание') : t('Start', 'Начало')}><Input type="datetime-local" step="1" aria-label={`${position ? 'Block end' : 'Block start'} ${index + 1}`} value={programDateInput(origin + block[key] * 1000, zone)} onChange={(event) => update(blocks.map((entry) => entry.id === block.id ? { ...entry, [key]: (programDateInstant(event.target.value, zone) - origin) / 1000 } : entry))} /></Field>)}</div>
      <Button size="compact" onClick={() => update(blocks.filter((entry) => entry.id !== block.id))}>{t('Delete block', 'Удалить блок')}</Button>
    </div>)}
    {outside && <div role="alert"><p>{t('Program blocks extend beyond the event. They are preserved until you confirm a change.', 'Блоки выходят за границы события. Они сохранены до подтверждения изменений.')}</p><Button onClick={extend}>{t('Extend event to fit', 'Расширить событие')}</Button><Button onClick={() => {
      const affected = programOverflow(item); const length = (Date.parse(item.schedule?.endAt ?? '') - origin) / 1000;
      const description = affected.map((block) => `${block.title}: ${block.startOffsetSeconds >= length ? t('delete', 'удалить') : t('shorten', 'сократить')}`).join('\n');
      if (window.confirm(`${t('Adjust program?', 'Скорректировать программу?')}\n${description}`)) { try { onChange(trimEventProgram(item)); } catch (reason) { setError(String(reason)); } }
    }}>{t('Trim program', 'Сократить программу')}</Button></div>}
    <div className="program-actions"><Button disabled={item.schedule?.allDay || blocks.some((block) => !Number.isFinite(block.endOffsetSeconds))} onClick={add}>{t('Add block', 'Добавить блок')}</Button><Button onClick={apply}>{t('Apply', 'Применить')}</Button></div>
    {error && <p role="alert">{error}</p>}
    {blocks.length > 0 && <output>{eventProgramStatus(item, now, language)}</output>}
  </Disclosure>;
}
