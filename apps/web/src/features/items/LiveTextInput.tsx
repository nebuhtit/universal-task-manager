import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { orderedOrganizationNames, type WorkspaceDocument } from '@utm/core';
import { organizationSuggestions } from '../../../quick-entry-lab/organization';
import { dateValueExpression, parseLiveEntry as parseEntry, suggest, type Draft } from '../../../quick-entry-lab/parser';
import { Button, Input, Textarea } from '../../components/ui/primitives';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { saveLiveTextReport } from './liveTextReports';
import './live-text.css';

export function LiveTextInput({ value, onChange, workspaceId, workspace, language = 'ru', suggestionsEnabled = true, inputRef, multiline = false, overlaySuggestions = false, placeholder = 'Add new item', ariaLabel, now, error, id: inputId, autoFocus, onViewCalendarDate, timeZone, onSubmit }: {
  value: string; onChange: (value: string) => void; workspaceId: string; suggestionsEnabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>; multiline?: boolean; overlaySuggestions?: boolean; placeholder?: string; ariaLabel?: string; now: Date; error?: string; id?: string; autoFocus?: boolean; language?: string; onViewCalendarDate?: (dateKey: string) => void; timeZone?: string;
  onSubmit?: (text: string) => void;
  workspace?: WorkspaceDocument;
}) {
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), ownInput = useRef<HTMLInputElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const touchStartY = useRef<number | null>(null);
  const lastTouchSelection = useRef(0);
  const calendarTouchStartY = useRef<number | null>(null);
  const lastCalendarTouch = useRef(0);
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
  const [overlayStyle, setOverlayStyle] = useState<CSSProperties>();
  const parsed = useMemo(() => parseEntry(value, referenceTime), [value, referenceTime]);
  const calendarDate = useMemo(() => {
    if (!onViewCalendarDate || !new RegExp(`(?:^|\\s)${dateValueExpression}(?=\\s|$)`, 'i').test(value)) return null;
    const at = parsed.plannedDate ?? parsed.start ?? parsed.due;
    if (!at) return null;
    if (parsed.plannedDate) return parsed.plannedDate;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }, [onViewCalendarDate, parsed.plannedDate, parsed.start, parsed.due, timeZone, value]);
  const catalog = useMemo(() => workspace ? { area: orderedOrganizationNames(workspace, 'area'), project: orderedOrganizationNames(workspace, 'project'), tag: orderedOrganizationNames(workspace, 'tag') } : { area: [], project: [], tag: [] }, [workspace]);
  const suggestions = useMemo(() => organizationSuggestions(value, caret, catalog) ?? suggest(value, caret, referenceTime, language === 'ru' ? 'ru' : 'en'), [value, caret, referenceTime, language, catalog]);
  const expanded = focused && open && suggestionsEnabled && suggestions.options.length > 0;
  useLayoutEffect(() => { if (expanded && panel.current) panel.current.scrollTop = suggestions.ordered ? 0 : panel.current.scrollHeight; }, [expanded, value, suggestions.ordered]);
  useEffect(() => { if (expanded && selected >= 0) document.getElementById(`${id}-option-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [expanded, selected, id]);
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const position = pendingCaret.current; pendingCaret.current = null;
    control()?.focus(); control()?.setSelectionRange(position, position);
  }, [value]);
  const updateOverlayPosition = () => {
    const element = control() ?? root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    const rect = element?.getBoundingClientRect();
    if (!element || !rect) return;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const dialogTop = element.closest('.ui-dialog-popup')?.getBoundingClientRect().top ?? viewportTop;
    const availableAbove = Math.max(0, rect.top - Math.max(viewportTop, dialogTop));
    const footerTop = element.closest('.ui-dialog-popup')?.querySelector('.ui-dialog-footer')?.getBoundingClientRect().top;
    const viewportBottom = Math.min(viewportTop + (window.visualViewport?.height ?? window.innerHeight), footerTop ?? Infinity);
    const availableBelow = Math.max(0, viewportBottom - rect.bottom);
    if (window.innerWidth <= 620 && availableBelow >= 96) {
      setOverlayStyle({ left: rect.left, width: rect.width, top: `calc(${rect.bottom}px + var(--space-2))`, bottom: 'auto', maxHeight: `max(0px, calc(${availableBelow}px - 2 * var(--space-2)))` });
      return;
    }
    setOverlayStyle({
      left: rect.left,
      width: rect.width,
      bottom: `calc(${Math.max(0, window.innerHeight - rect.top)}px + var(--space-2))`,
      maxHeight: `max(0px, calc(${availableAbove}px - 2 * var(--space-2)))`,
    });
  };
  useLayoutEffect(() => {
    if (!focused || !open || !overlaySuggestions) { setOverlayStyle(undefined); return; }
    const updatePosition = () => {
      updateOverlayPosition();
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); window.visualViewport?.removeEventListener('resize', updatePosition); window.visualViewport?.removeEventListener('scroll', updatePosition); };
  }, [focused, open, overlaySuggestions, value]);
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
  const common = {
    value, placeholder, id: inputId, autoFocus, 'aria-label': ariaLabel ?? placeholder, autoComplete: 'off', spellCheck: false, maxLength: 2000,
    role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': expanded, 'aria-controls': `${id}-options`,
    'aria-activedescendant': expanded && selected >= 0 ? `${id}-option-${selected}` : undefined,
    onFocus: () => { setFocused(true); setOpen(true); setReferenceTime(now); if (overlaySuggestions) requestAnimationFrame(updateOverlayPosition); },
    onBlur: () => { setFocused(false); setOpen(false); },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { onChange(event.target.value); setCaret(event.target.selectionStart ?? 0); setSelected(-1); setOpen(true); setNotice(''); setReferenceTime(now); if (overlaySuggestions) requestAnimationFrame(updateOverlayPosition); },
    onSelect: (event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>) => setCaret(event.currentTarget.selectionStart ?? 0),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); } setOpen(false); return; }
      // On iPhone the keyboard action is a form submission, even when a
      // suggestion was highlighted earlier. Space still applies that option.
      if (event.key === 'Enter' && !multiline && !overlaySuggestions && window.matchMedia('(pointer: coarse)').matches) { event.preventDefault(); submitControl(event.currentTarget); return; }
      if (expanded && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected((current) => current < 0 ? event.key === 'ArrowDown' ? 0 : suggestions.options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.options.length) % suggestions.options.length); }
      else if (expanded && event.key === 'Tab') { event.preventDefault(); setSelected((current) => current < 0 ? event.shiftKey ? suggestions.options.length - 1 : 0 : (current + (event.shiftKey ? -1 : 1) + suggestions.options.length) % suggestions.options.length); }
      else if (expanded && selected >= 0 && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(selected); }
      else if (event.key === 'Enter' && !multiline && !overlaySuggestions) { event.preventDefault(); submitControl(event.currentTarget); }
    },
  };
  const suggestionPanel = focused && value.trim() && (!overlaySuggestions || open) && <div ref={panel} className={`live-text-panel${overlaySuggestions ? ' live-text-panel-overlay' : ''}`} style={overlayStyle}>
      {suggestionsEnabled && summary && <div className="live-text-preview">{summary}</div>}
      {message && <div role="alert" className="ui-field-error">{message}</div>}
      {expanded && overlaySuggestions && <Button size="compact" variant="ghost" aria-label="Close Live text suggestions" onPointerDown={(event) => event.preventDefault()} onClick={() => setOpen(false)}>×</Button>}
      {calendarDate && <Button size="compact" variant="ghost" onPointerDown={(event) => event.preventDefault()} onTouchStart={(event) => { calendarTouchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event) => { const endY = event.changedTouches[0]?.clientY; if (calendarTouchStartY.current !== null && endY !== undefined && Math.abs(endY - calendarTouchStartY.current) < 10) { event.preventDefault(); lastCalendarTouch.current = Date.now(); onViewCalendarDate?.(calendarDate); } calendarTouchStartY.current = null; }} onTouchCancel={() => { calendarTouchStartY.current = null; }} onClick={() => { if (Date.now() - lastCalendarTouch.current > 500) onViewCalendarDate?.(calendarDate); }}>{/[а-яё]/i.test(value) ? 'Посмотреть в календаре' : 'View in calendar'}</Button>}
      <Button size="compact" variant="ghost" onPointerDown={(event) => event.preventDefault()} onClick={() => { setReport({ input: value, parsed, referenceTime: referenceTime.toISOString() }); setExpected(''); setReportError(''); }}>Сообщить о неточности</Button>
      {notice && <small role="status">{notice}</small>}
      {expanded && <div id={`${id}-options`} role="listbox" aria-label="Подсказки Live text" className="live-text-options">
        {(suggestions.ordered ? suggestions.options.map((option, index) => ({ option, index })) : suggestions.options.map((option, index) => ({ option, index })).reverse()).map(({ option, index }) => <div key={`${index}-${option.label}`} id={`${id}-option-${index}`} role="option" aria-selected={selected === index} onPointerDown={(event) => event.preventDefault()} onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={(event) => { const endY = event.changedTouches[0]?.clientY; if (touchStartY.current !== null && endY !== undefined && Math.abs(endY - touchStartY.current) < 10) { event.preventDefault(); lastTouchSelection.current = Date.now(); choose(index); } touchStartY.current = null; }} onTouchCancel={() => { touchStartY.current = null; }} onClick={() => { if (Date.now() - lastTouchSelection.current > 500) choose(index); }}><strong>{option.label}</strong><small>{option.detail}</small></div>)}
      </div>}
    </div>;
  return <div className="live-text-input" ref={root}>
    {suggestionPanel && (overlaySuggestions && typeof document !== 'undefined' ? createPortal(suggestionPanel, document.body) : suggestionPanel)}
    {multiline ? <Textarea {...common} ref={textarea} rows={4} /> : <Input {...common} ref={inputRef ?? ownInput} enterKeyHint={overlaySuggestions ? 'done' : 'go'} />}
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
