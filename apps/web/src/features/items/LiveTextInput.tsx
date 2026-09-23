import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { orderedOrganizationNames, type WorkspaceDocument } from '@utm/core';
import { organizationSuggestions } from '../../../quick-entry-lab/organization';
import { dateValueExpression, parseLiveEntry as parseEntry, suggest, type Draft } from '../../../quick-entry-lab/parser';
import { Button, Input, Textarea } from '../../components/ui/primitives';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { saveLiveTextReport } from './liveTextReports';
import { timelineData } from '../calendar/timelineData';
import { buildSegments, positionAt } from '../calendar/timelineLayout';
import './live-text.css';

export function LiveTextInput({ value, onChange, workspaceId, workspace, language = 'ru', suggestionsEnabled = true, inputRef, multiline = false, overlaySuggestions = false, placeholder = 'Add new item', ariaLabel, now, error, id: inputId, autoFocus, onViewCalendarDate, viewedTimelineDate, timeZone, onSubmit }: {
  value: string; onChange: (value: string) => void; workspaceId: string; suggestionsEnabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>; multiline?: boolean; overlaySuggestions?: boolean; placeholder?: string; ariaLabel?: string; now: Date; error?: string; id?: string; autoFocus?: boolean; language?: string; onViewCalendarDate?: (dateKey: string) => void; viewedTimelineDate?: string | undefined; timeZone?: string;
  onSubmit?: (text: string) => void;
  workspace?: WorkspaceDocument;
}) {
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), ownInput = useRef<HTMLInputElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const touchStartY = useRef<number | null>(null);
  const lastTouchSelection = useRef(0);
  const calendarTouchStartY = useRef<number | null>(null);
  const lastCalendarTouch = useRef(0);
  const previewButton = useRef<HTMLButtonElement>(null);
  const previewTouch = useRef<{ x: number; y: number } | null>(null);
  const control = () => multiline ? textarea.current : (inputRef ?? ownInput).current;
  const lastSubmit = useRef({ value: '', at: 0 });
  const submitControl = (element: HTMLInputElement | HTMLTextAreaElement) => {
    const text = element.value;
    if (!text.trim() || (lastSubmit.current.value === text && performance.now() - lastSubmit.current.at < 500)) return;
    lastSubmit.current = { value: text, at: performance.now() };
    if (onSubmit) onSubmit(text); else element.form?.requestSubmit();
  };
  useEffect(() => {
    const element = control();
    if (!element || multiline || overlaySuggestions) return;
    // Some iOS keyboard actions expose beforeinput instead of a useful keydown.
    const beforeInput = (event: Event) => {
      const input = event as InputEvent;
      if (!input.isComposing && ['insertLineBreak', 'insertParagraph'].includes(input.inputType)) { event.preventDefault(); submitControl(element); }
    };
    element.addEventListener('beforeinput', beforeInput);
    return () => element.removeEventListener('beforeinput', beforeInput);
  }, [onSubmit, multiline, overlaySuggestions]);
  const id = useId();
  const [focused, setFocused] = useState(false), [open, setOpen] = useState(false), [caret, setCaret] = useState(value.length), [selected, setSelected] = useState(-1);
  const pendingCaret = useRef<number | null>(null);
  const [referenceTime, setReferenceTime] = useState(now);
  const [report, setReport] = useState<{ input: string; parsed: Draft; referenceTime: string } | null>(null);
  const [expected, setExpected] = useState(''), [reportError, setReportError] = useState(''), [notice, setNotice] = useState('');
  const [calendar, setCalendar] = useState<{ start: number; end: number; insert: string; source: string } | null>(null);
  const [date, setDate] = useState('');
  const parsed = useMemo(() => parseEntry(value, referenceTime), [value, referenceTime]);
  const highlight = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState(false);
  const highlighted = !composing && Boolean(parsed.commandSpans?.length);
  const syncHighlight = () => {
    const element = control(), layer = highlight.current;
    if (!element || !layer) return;
    const style = getComputedStyle(element);
    for (const property of ['font', 'letter-spacing', 'line-height', 'padding', 'border-width', 'border-radius', 'text-align', 'text-indent', 'box-sizing']) layer.style.setProperty(property, style.getPropertyValue(property));
    Object.assign(layer.style, { top: `${element.offsetTop}px`, left: `${element.offsetLeft}px`, width: `${element.offsetWidth}px`, height: `${element.offsetHeight}px` });
    layer.scrollLeft = element.scrollLeft; layer.scrollTop = element.scrollTop;
  };
  useLayoutEffect(() => {
    syncHighlight();
    const element = control();
    if (!element || !highlighted) return;
    const observer = new ResizeObserver(syncHighlight); observer.observe(element);
    return () => observer.disconnect();
  }, [value, highlighted, multiline, focused, open]);
  const calendarDate = useMemo(() => {
    if (!workspace || !new RegExp(`(?:^|\\s)${dateValueExpression}(?=\\s|$)`, 'i').test(value)) return null;
    const at = parsed.plannedDate ?? parsed.start ?? parsed.due;
    if (!at) return null;
    if (parsed.plannedDate) return parsed.plannedDate;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }, [workspace, parsed.plannedDate, parsed.start, parsed.due, timeZone, value]);
  const previewMinute = Math.floor(referenceTime.getTime() / 60_000);
  const dayPreview = useMemo(() => calendarDate && workspace ? timelineData(workspace, calendarDate, referenceTime) : null, [calendarDate, workspace, previewMinute]);
  const previewSegments = useMemo(() => dayPreview ? buildSegments(dayPreview.day, dayPreview.hidden) : [], [dayPreview]);
  const previewHeight = previewSegments.at(-1) ? previewSegments.at(-1)!.top + previewSegments.at(-1)!.height : 1;
  const previewPercent = (at: number) => positionAt(at, previewSegments) / previewHeight * 100;
  const visiblePreview = dayPreview && calendarDate !== viewedTimelineDate;
  const dayPreviewEvents = useMemo(() => dayPreview?.events.filter(event => !event.tentative && !event.invalid && !event.travel)
    .sort((left, right) => left.start - right.start || left.item.id.localeCompare(right.item.id)) ?? [], [dayPreview]);
  const catalog = useMemo(() => workspace ? { area: orderedOrganizationNames(workspace, 'area'), project: orderedOrganizationNames(workspace, 'project'), tag: [...new Set(Object.values(workspace.items).filter(item => !item.deletedAt).flatMap(item => item.tags))].sort() } : { area: [], project: [], tag: [] }, [workspace]);
  const suggestions = useMemo<ReturnType<typeof suggest>>(() => organizationSuggestions(value, caret, catalog) ?? suggest(value, caret, referenceTime, language === 'ru' ? 'ru' : 'en'), [value, caret, referenceTime, language, catalog]);
  const expanded = focused && open && suggestionsEnabled && suggestions.options.length > 0;
  useLayoutEffect(() => { if (expanded && panel.current) panel.current.scrollTop = panel.current.scrollHeight; }, [expanded, value, suggestions.ordered]);
  useEffect(() => { if (expanded && selected >= 0) document.getElementById(`${id}-option-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [expanded, selected, id]);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const position = pendingCaret.current; pendingCaret.current = null;
    control()?.focus(); control()?.setSelectionRange(position, position);
  }, [value]);
  const replace = (start: number, end: number, insert: string) => {
    pendingCaret.current = start + insert.length;
    onChange(value.slice(0, start) + insert + value.slice(end));
    setCaret(start + insert.length); setSelected(-1); setOpen(true);
  };
  const choose = (index: number) => {
    const option = suggestions.options[index]; if (!option) return;
    if (option.calendar) { setCalendar({ ...suggestions, insert: option.insert, source: value }); setDate(''); setOpen(false); return; }
    replace(option.replaceStart ?? suggestions.start, option.replaceEnd ?? suggestions.end, option.insert);
  };
  const message = error || parsed.errors.join(' ');
  const format = (at: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  const summary = [parsed.plannedDate && `${parsed.plannedDate} · без времени`, parsed.start && `▷ ${format(parsed.start)}`, parsed.end && `→ ${format(parsed.end)}`, parsed.due && `Due ${format(parsed.due)}`, parsed.travelMinutes !== null && `Дорога ${parsed.travelMinutes} мин`, parsed.reminders.length > 0 && `Напоминания: ${parsed.reminders.length}`].filter(Boolean).join(' · ');
  const previewClock = (at: number) => new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: timeZone ?? workspace?.calendarPreferences.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const viewCalendarDate = () => { if (!calendarDate) return; setOpen(false); setFocused(false); control()?.blur(); onViewCalendarDate?.(calendarDate); };
  useEffect(() => {
    if (!visiblePreview || !focused) return;
    const start = (event: TouchEvent) => {
      if (!previewButton.current?.contains(event.target as Node)) return;
      event.preventDefault();
      previewTouch.current = { x: event.touches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? 0 };
    };
    const end = (event: TouchEvent) => {
      const initial = previewTouch.current;
      previewTouch.current = null;
      if (!initial || !event.changedTouches[0]) return;
      if (Math.hypot(event.changedTouches[0].clientX - initial.x, event.changedTouches[0].clientY - initial.y) > 10) return;
      event.preventDefault();
      lastCalendarTouch.current = Date.now();
      viewCalendarDate();
    };
    const cancel = () => { previewTouch.current = null; };
    document.addEventListener('touchstart', start, { capture: true, passive: false });
    document.addEventListener('touchend', end, { capture: true, passive: false });
    document.addEventListener('touchcancel', cancel, true);
    return () => {
      document.removeEventListener('touchstart', start, true);
      document.removeEventListener('touchend', end, true);
      document.removeEventListener('touchcancel', cancel, true);
    };
  }, [visiblePreview, focused, calendarDate, onViewCalendarDate]);
  const common = {
    className: highlighted ? 'live-text-colored-control' : undefined,
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
    onScroll: syncHighlight,
    value, placeholder, id: inputId, autoFocus, 'aria-label': ariaLabel ?? placeholder, autoComplete: 'off', spellCheck: false, maxLength: 2000,
    role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': expanded, 'aria-controls': `${id}-options`,
    'aria-activedescendant': expanded && selected >= 0 ? `${id}-option-${selected}` : undefined,
    onFocus: () => { setFocused(true); setOpen(true); setReferenceTime(now); },
    onBlur: () => { setFocused(false); setOpen(false); },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { onChange(event.target.value); setCaret(event.target.selectionStart ?? 0); setSelected(-1); setOpen(true); setNotice(''); setReferenceTime(now); },
    onSelect: (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => { setCaret(event.currentTarget.selectionStart ?? 0); requestAnimationFrame(syncHighlight); },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); } setOpen(false); return; }
      // Enter submits capture (or bubbles to the editor), never a suggestion.
      if (event.key === 'Enter') { if (!multiline && !overlaySuggestions) { event.preventDefault(); submitControl(event.currentTarget); } return; }
      if (expanded && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected((current) => current < 0 ? 0 : (current + (event.key === 'ArrowUp' ? 1 : -1) + suggestions.options.length) % suggestions.options.length); }
      else if (expanded && event.key === 'Tab') { event.preventDefault(); setSelected((current) => current < 0 ? event.shiftKey ? suggestions.options.length - 1 : 0 : (current + (event.shiftKey ? -1 : 1) + suggestions.options.length) % suggestions.options.length); }
      else if (expanded && selected >= 0 && event.key === ' ') { event.preventDefault(); choose(selected); }
    },
  };
  const suggestionPanel = focused && value.trim() && (!overlaySuggestions || open) && <div className={`live-text-panel${overlaySuggestions ? ' live-text-panel-inline' : ''}`}>
      {dayPreview && calendarDate && visiblePreview && <button ref={previewButton} type="button" className="live-day-preview" aria-label={language === 'ru' ? `Открыть ${calendarDate} в Timeline` : `Open ${calendarDate} in Timeline`} onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault(); }} onClick={() => { if (Date.now() - lastCalendarTouch.current > 500) viewCalendarDate(); }}>
        <div className="live-day-preview-heading"><strong>{new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${calendarDate}T12:00:00Z`))}</strong><span>{language === 'ru' ? `Событий: ${dayPreviewEvents.length}${dayPreview.allDay.length ? ` · весь день: ${dayPreview.allDay.length}` : ''}` : `Events: ${dayPreviewEvents.length}${dayPreview.allDay.length ? ` · all day: ${dayPreview.allDay.length}` : ''}`}</span></div>
        <div className="live-day-preview-track" aria-hidden="true">{previewSegments.filter(segment => segment.hidden).map(segment => <span key={segment.start} className="live-day-preview-hidden" style={{ left: `${previewPercent(segment.start)}%`, width: `${segment.height / previewHeight * 100}%` }} />)}{dayPreviewEvents.filter(event => !previewSegments.some(segment => segment.hidden && event.start >= segment.start && event.end <= segment.end)).map((event, index) => <span key={`${event.item.id}-${index}`} className="live-day-preview-event" style={{ left: `${previewPercent(event.start)}%`, width: `${Math.max(0.8, previewPercent(Math.min(event.end, dayPreview.day.end)) - previewPercent(Math.max(event.start, dayPreview.day.start)))}%` }} />)}</div>
        <div className="live-day-preview-hours" aria-hidden="true">{[dayPreview.day.start, dayPreview.day.start + (dayPreview.day.end - dayPreview.day.start) / 4, dayPreview.day.start + (dayPreview.day.end - dayPreview.day.start) / 2, dayPreview.day.start + (dayPreview.day.end - dayPreview.day.start) * 3 / 4, dayPreview.day.end].filter((at, index, values) => index === 0 || index === values.length - 1 || (previewPercent(at) - previewPercent(values[index - 1]!) >= 15 && previewPercent(at) <= 85)).map(at => <span key={at} style={{ left: `${previewPercent(at)}%` }}>{previewClock(at)}</span>)}</div>
        {dayPreviewEvents.length > 0 && <div className="live-day-preview-labels">{dayPreviewEvents.slice(0, 3).map((event, index) => <span key={`${event.item.id}-${index}`}>{previewClock(event.start)} {event.item.title}</span>)}{dayPreviewEvents.length > 3 && <span>+{dayPreviewEvents.length - 3}</span>}</div>}
      </button>}
      <div ref={panel} className="live-text-panel-body">
      {suggestionsEnabled && summary && <div className="live-text-preview">{summary}</div>}
      {message && <div role="alert" className="ui-field-error">{message}</div>}
      {expanded && overlaySuggestions && <Button size="compact" variant="ghost" aria-label="Close Live text suggestions" onPointerDown={(event) => event.preventDefault()} onClick={() => setOpen(false)}>×</Button>}
      {calendarDate && !visiblePreview && <Button size="compact" variant="ghost" onPointerDown={(event) => event.preventDefault()} onTouchStart={(event) => { calendarTouchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event) => { const endY = event.changedTouches[0]?.clientY; if (calendarTouchStartY.current !== null && endY !== undefined && Math.abs(endY - calendarTouchStartY.current) < 10) { event.preventDefault(); lastCalendarTouch.current = Date.now(); viewCalendarDate(); } calendarTouchStartY.current = null; }} onTouchCancel={() => { calendarTouchStartY.current = null; }} onClick={() => { if (Date.now() - lastCalendarTouch.current > 500) viewCalendarDate(); }}>{/[а-яё]/i.test(value) ? 'Посмотреть в календаре' : 'View in calendar'}</Button>}
      <Button size="compact" variant="ghost" onPointerDown={(event) => event.preventDefault()} onClick={() => { setReport({ input: value, parsed, referenceTime: referenceTime.toISOString() }); setExpected(''); setReportError(''); }}>Сообщить о неточности</Button>
      {notice && <small role="status">{notice}</small>}
      {expanded && <div id={`${id}-options`} role="listbox" aria-label="Подсказки Live text" className="live-text-options">
        {suggestions.options.map((option, index) => ({ option, index })).reverse().map(({ option, index }) => <div key={`${index}-${option.label}`} id={`${id}-option-${index}`} role="option" aria-selected={selected === index} onPointerDown={(event) => event.preventDefault()} onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event) => { const endY = event.changedTouches[0]?.clientY; if (touchStartY.current !== null && endY !== undefined && Math.abs(endY - touchStartY.current) < 10) { event.preventDefault(); lastTouchSelection.current = Date.now(); choose(index); } touchStartY.current = null; }} onTouchCancel={() => { touchStartY.current = null; }} onClick={() => { if (Date.now() - lastTouchSelection.current > 500) choose(index); }}><strong>{option.label}</strong><small>{option.detail}</small></div>)}
      </div>}
      </div>
    </div>;
  return <div className="live-text-input" ref={root}>
    {!overlaySuggestions && !multiline && suggestionPanel}
    {multiline ? <Textarea {...common} ref={textarea} rows={4} /> : <Input {...common} ref={inputRef ?? ownInput} enterKeyHint={overlaySuggestions ? 'done' : 'go'} />}
    {(overlaySuggestions || multiline) && suggestionPanel}
    {highlighted && <div ref={highlight} aria-hidden="true" className={`live-text-highlight${multiline ? ' is-multiline' : ''}`}><span>{(() => {
      let cursor = 0;
      const parts: React.ReactNode[] = [];
      for (const span of parsed.commandSpans ?? []) {
        if (span.start < cursor || span.end > value.length) continue;
        parts.push(value.slice(cursor, span.start), <span className="live-text-command" key={span.start}>{value.slice(span.start, span.end)}</span>);
        cursor = span.end;
      }
      parts.push(value.slice(cursor), value.endsWith('\n') ? '\u200b' : '');
      return parts;
    })()}</span></div>}
    {report && <ResponsiveDialog open onOpenChange={(visible) => { if (!visible) setReport(null); }} title="Ошибка разбора Live text" ariaLabel="Ошибка разбора Live text" finalFocus={() => control() ?? false}>
      <p className="live-text-report-source">{report.input}</p>
      <label>Как должно быть<Textarea aria-label="Как должно быть" value={expected} onChange={(event) => setExpected(event.target.value)} maxLength={2000} rows={4} /></label>
      <p className="ui-field-hint">Отчёт хранится на этом устройстве без шифрования: текст, результат разбора и ваше пояснение. Отправки на сервер нет. Экспорт и очистка — в настройках Live text.</p>
      {reportError && <p role="alert" className="ui-field-error">{reportError}</p>}
      <div className="live-text-report-actions"><Button onClick={() => setReport(null)}>Отмена</Button><Button disabled={!expected.trim()} onClick={() => { try { saveLiveTextReport(workspaceId, { ...report, expected: expected.trim() }); setReport(null); setNotice('Отчёт сохранён'); } catch (reason) { setReportError(String(reason)); } }}>Сохранить отчёт</Button></div>
    </ResponsiveDialog>}
    {calendar && <ResponsiveDialog open onOpenChange={(visible) => { if (!visible) setCalendar(null); }} title="Дата" ariaLabel="Дата Live text" finalFocus={() => control() ?? false}>
      <Input type="date" aria-label="Дата Live text" value={date} onChange={(event) => setDate(event.target.value)} />
      <Button disabled={!date} onClick={() => { if (value === calendar.source) replace(calendar.start, calendar.end, calendar.insert.replace('__DATE__', date)); setCalendar(null); }}>Применить</Button>
    </ResponsiveDialog>}
  </div>;
}
