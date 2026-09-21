import { useEffect, useRef, useState } from 'react';
import { createId, eventProgramStatus, programOverflow, syncEventProgramScript, trimEventProgram, type UniversalItem } from '@utm/core';
import { Button, Disclosure, Field, Input } from '../../../../components/ui/primitives';
import { programDateInput, programDateInstant } from './programDates';
import './event-program.css';
import { CodeEditor } from '../../../../components/ui/CodeEditor';
import { formatProgramText, parseProgramText, programDay, programTimeParts } from './programText';

export function EventProgramSection({ item, onChange, language, now, occurrences = [], onOpenOccurrence, onValidityChange }: { item: UniversalItem; onChange: (item: UniversalItem) => void; language: string; now: Date; occurrences?: UniversalItem[]; onValidityChange?: ((valid: boolean) => void) | undefined; onOpenOccurrence?: ((item: UniversalItem) => void) | undefined }) {
  const ru = language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'blocks' | 'text'>('blocks');
  const [text, setText] = useState('');
  const [textValid, setTextValid] = useState(true);
  const [dayFields, setDayFields] = useState<Set<string>>(() => new Set());
  const textOrigin = useRef<number>(NaN);
  const root = useRef<HTMLDivElement>(null);
  const autoEnd = useRef(!item.schedule?.endAt);
  const autoStart = useRef(!item.schedule?.startAt);
  const autoOrigin = useRef<number>(NaN);
  const blocks = item.eventProgram?.blocks ?? [];
  const zone = item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const origin = Date.parse(item.schedule?.startAt ?? '');
  const fingerprint = (value: UniversalItem) => JSON.stringify([value.schedule?.startAt, value.eventProgram]);
  const published = useRef(fingerprint(item));
  useEffect(() => {
    const current = fingerprint(item);
    if (current !== published.current && mode === 'text' && textValid) {
      textOrigin.current = origin;
      setText(blocks.length ? formatProgramText(blocks, origin, zone) : '');
    }
    published.current = current;
  }, [item, mode, textValid, origin, zone]);
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
    published.current = fingerprint(next); onChange(next); setError('');
  };
  const editText = (value: string) => {
    setText(value);
    try {
      if (item.schedule?.allDay && value.trim()) throw new Error(t('Switch off All day to add program blocks.', 'Выключите «Весь день», чтобы добавить блоки программы.'));
      const base = Number.isFinite(textOrigin.current) ? textOrigin.current : Number.isFinite(origin) ? origin : Math.floor(now.getTime() / 60000) * 60000;
      textOrigin.current = base;
      const delta = Number.isFinite(origin) ? (origin - base) / 1000 : 0;
      const previous = blocks.map((entry) => ({ ...entry, startOffsetSeconds: entry.startOffsetSeconds + delta, endOffsetSeconds: entry.endOffsetSeconds + delta }));
      const parsed = parseProgramText(value, base, zone, previous);
      const next = parsed.map((entry) => ({ ...entry, startOffsetSeconds: entry.startOffsetSeconds - delta, endOffsetSeconds: entry.endOffsetSeconds - delta }));
      if (!Number.isFinite(origin) && next.length) {
        const shift = Math.min(...next.map((entry) => entry.startOffsetSeconds));
        const startAt = new Date(base + shift * 1000).toISOString();
        autoOrigin.current = Date.parse(startAt);
        const value = { ...item, schedule: { ...item.schedule, timezone: zone, startAt, ...(!item.schedule?.endAt ? { endAt: new Date(base + Math.max(...next.map((entry) => entry.endOffsetSeconds)) * 1000).toISOString() } : {}) }, eventProgram: { blocks: next.map((entry) => ({ ...entry, startOffsetSeconds: entry.startOffsetSeconds - shift, endOffsetSeconds: entry.endOffsetSeconds - shift })) } }; published.current = fingerprint(value); onChange(value);
      } else update(next);
      setTextValid(true); onValidityChange?.(true); setError('');
    } catch (reason) { setTextValid(false); onValidityChange?.(false); setError(String(reason)); }
  };
  const add = () => {
    const base = Number.isFinite(origin) ? origin : Math.floor(now.getTime() / 60000) * 60000;
    const start = blocks.at(-1)?.endOffsetSeconds ?? 0;
    const end = start + 1800;
    const nextBlocks = [...blocks, { id: createId(), title: '', startOffsetSeconds: start, endOffsetSeconds: end }];
    if (!Number.isFinite(origin)) { autoOrigin.current = base; onChange({ ...item, schedule: { ...item.schedule, timezone: zone, startAt: new Date(base).toISOString(), ...(!item.schedule?.endAt ? { endAt: new Date(base + end * 1000).toISOString() } : {}) }, eventProgram: { blocks: nextBlocks } }); }
    else update(nextBlocks);
    requestAnimationFrame(() => { const fields = root.current?.querySelectorAll<HTMLInputElement>('[data-program-title]'); fields?.[fields.length - 1]?.focus(); });
  };
  const apply = () => {
    try {
      if (!textValid) return;
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
    <div ref={root}>
    <small className="schedule-explainer">{zone}</small>
    <div className="program-actions"><Button aria-pressed={mode === 'blocks'} disabled={!textValid} onClick={() => setMode('blocks')}>{t('Blocks', 'Блоки')}</Button><Button aria-pressed={mode === 'text'} onClick={() => { if (mode !== 'text') { textOrigin.current = Number.isFinite(origin) ? origin : Math.floor(now.getTime() / 60000) * 60000; setText(blocks.length ? formatProgramText(blocks, origin, zone) : ''); setMode('text'); } }}>{t('Text', 'Текст')}</Button></div>
    {mode === 'text' && <><p className="schedule-explainer">17:00–17:45 {t('Lesson', 'Урок')} · +1 = {t('next day', 'следующий день')}</p><CodeEditor language="dsl" ariaLabel={t('Program text', 'Текст программы')} value={text} onChange={editText} /></>}
    {item.role === 'series_template' && <small className="schedule-explainer">{t('This program is inherited by new occurrences.', 'Эту программу наследуют новые повторения.')}</small>}
    {onOpenOccurrence && occurrences.length > 0 && <Disclosure uiKey={`program-occurrences:${item.id}`} persist={false} summary={t('Program for an individual occurrence', 'Программа отдельного повторения')}><div className="program-actions">{occurrences.map((entry) => <Button key={entry.id} onClick={() => onOpenOccurrence(entry)}>{programDateInput(Date.parse(entry.schedule?.startAt ?? ''), zone).replace('T', ' ') || entry.title}</Button>)}</div></Disclosure>}
    {item.schedule?.allDay && <p>{t('Switch off All day to add program blocks.', 'Выключите «Весь день», чтобы добавить блоки программы.')}</p>}
    {mode === 'blocks' && blocks.map((block, index) => <div className="program-block" key={block.id}>
      <Field label={t('Block title', 'Название блока')}><Input data-program-title aria-label={`${t('Block title', 'Название блока')} ${index + 1}`} value={block.title} onChange={(event) => update(blocks.map((entry) => entry.id === block.id ? { ...entry, title: event.target.value } : entry))} /></Field>
      <div className="program-times">{(['startOffsetSeconds', 'endOffsetSeconds'] as const).map((key, position) => {
        const parts = programTimeParts(origin + block[key] * 1000, origin, zone);
        const change = (day: number, time: string) => { const instant = programDateInstant(`${programDay(origin, zone, day)}T${time}`, zone); if (!Number.isFinite(instant)) { setError(t('Invalid time', 'Некорректное время')); return; } update(blocks.map((entry) => entry.id === block.id ? { ...entry, [key]: (instant - origin) / 1000 } : entry)); };
        const fieldKey = `${block.id}:${key}`;
        return <Field key={key} label={position ? t('End', 'Окончание') : t('Start', 'Начало')}><Input type="time" step="1" aria-label={`${position ? 'Block end' : 'Block start'} ${index + 1}`} value={parts.time} onChange={(event) => change(parts.day, event.target.value)} />{parts.day !== 0 || dayFields.has(fieldKey) ? <label className="program-day">{t('Day offset', 'Сдвиг дня')}<Input type="number" min={0} step={1} aria-label={`${position ? 'End day' : 'Start day'} ${index + 1}`} value={parts.day} onChange={(event) => { const raw = event.target.value; const day = Number(raw); if (!raw || day === 0) { setDayFields((current) => { const next = new Set(current); next.delete(fieldKey); return next; }); change(0, parts.time); return; } if (Number.isInteger(day) && day > 0 && day <= 36500) change(day, parts.time); }} /></label> : <Button size="compact" variant="ghost" onClick={() => { setDayFields((current) => new Set([...current, fieldKey])); change(1, parts.time); }}>{t('+1 day', '+1 день')}</Button>}</Field>;
      })}</div>
      <Button className="program-remove" size="compact" aria-label={`${t('Delete block', 'Удалить блок')} ${index + 1}`} onClick={() => update(blocks.filter((entry) => entry.id !== block.id))}>×</Button>
    </div>)}
    {outside && <div role="alert"><p>{t('Program blocks extend beyond the event. They are preserved until you confirm a change.', 'Блоки выходят за границы события. Они сохранены до подтверждения изменений.')}</p><Button onClick={extend}>{t('Extend event to the last block', 'Продлить событие до последнего блока')}</Button><Button onClick={() => {
      const affected = programOverflow(item); const length = (Date.parse(item.schedule?.endAt ?? '') - origin) / 1000;
      const description = affected.map((block) => `${block.title}: ${block.startOffsetSeconds >= length ? t('delete', 'удалить') : t('shorten', 'сократить')}`).join('\n');
      if (window.confirm(`${t('Adjust program?', 'Скорректировать программу?')}\n${description}`)) { try { onChange(trimEventProgram(item)); } catch (reason) { setError(String(reason)); } }
    }}>{t('Trim program', 'Сократить программу')}</Button></div>}
    <div className="program-actions"><Button disabled={mode === 'text' || item.schedule?.allDay || blocks.some((block) => !Number.isFinite(block.endOffsetSeconds))} onClick={add}>{t('Add block', 'Добавить блок')}</Button><Button onClick={apply}>{t('Apply', 'Применить')}</Button></div>
    {error && <p role="alert">{error}</p>}
    {blocks.length > 0 && <output>{eventProgramStatus(item, now, language)}</output>}
    </div>
  </Disclosure>;
}
