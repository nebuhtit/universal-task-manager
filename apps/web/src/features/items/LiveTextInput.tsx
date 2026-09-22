import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { parseEntry, suggest, type Draft } from '../../../quick-entry-lab/parser';
import { Button, Input, Textarea } from '../../components/ui/primitives';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { saveLiveTextReport } from './liveTextReports';
import './live-text.css';

export function LiveTextInput({ value, onChange, workspaceId, language = 'ru', suggestionsEnabled = true, inputRef, multiline = false, overlaySuggestions = false, placeholder = 'Add new item', ariaLabel, now, error, id: inputId, autoFocus }: {
  value: string; onChange: (value: string) => void; workspaceId: string; suggestionsEnabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>; multiline?: boolean; overlaySuggestions?: boolean; placeholder?: string; ariaLabel?: string; now: Date; error?: string; id?: string; autoFocus?: boolean; language?: string;
}) {
  const root = useRef<HTMLDivElement>(null), ownInput = useRef<HTMLInputElement>(null), textarea = useRef<HTMLTextAreaElement>(null);
  const control = () => multiline ? textarea.current : (inputRef ?? ownInput).current;
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
  const suggestions = useMemo(() => suggest(value, caret, referenceTime, language === 'ru' ? 'ru' : 'en'), [value, caret, referenceTime, language]);
  const expanded = focused && open && suggestionsEnabled && suggestions.options.length > 0;
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
    setOverlayStyle({
      left: rect.left,
      width: rect.width,
      bottom: `calc(${Math.max(0, window.innerHeight - rect.top)}px + var(--space-2))`,
      maxHeight: `max(0px, calc(${availableAbove}px - 2 * var(--space-2)))`,
    });
  };
  useLayoutEffect(() => {
    if (!expanded || !overlaySuggestions) { setOverlayStyle(undefined); return; }
    const updatePosition = () => {
      updateOverlayPosition();
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); window.visualViewport?.removeEventListener('resize', updatePosition); window.visualViewport?.removeEventListener('scroll', updatePosition); };
  }, [expanded, overlaySuggestions, value]);
  const replace = (start: number, end: number, insert: string) => {
    pendingCaret.current = start + insert.length;
    onChange(value.slice(0, start) + insert + value.slice(end));
    setCaret(start + insert.length); setSelected(-1); setOpen(true);
  };
  const choose = (index: number) => {
    const option = suggestions.options[index]; if (!option) return;
    if (option.calendar) { setCalendar({ ...suggestions, insert: option.insert, source: value }); setDate(''); setOpen(false); return; }
    replace(suggestions.start, suggestions.end, option.insert);
  };
  const message = error || parsed.errors.join(' ');
  const format = (at: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  const summary = [parsed.start && `▷ ${format(parsed.start)}`, parsed.end && `→ ${format(parsed.end)}`, parsed.due && `Due ${format(parsed.due)}`, parsed.travelMinutes !== null && `Дорога ${parsed.travelMinutes} мин`, parsed.reminders.length > 0 && `Напоминания: ${parsed.reminders.length}`].filter(Boolean).join(' · ');
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
      if (expanded && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected((current) => current < 0 ? event.key === 'ArrowDown' ? 0 : suggestions.options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.options.length) % suggestions.options.length); }
      else if (expanded && event.key === 'Tab') { event.preventDefault(); setSelected((current) => current < 0 ? event.shiftKey ? suggestions.options.length - 1 : 0 : (current + (event.shiftKey ? -1 : 1) + suggestions.options.length) % suggestions.options.length); }
      else if (expanded && selected >= 0 && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(selected); }
    },
  };
  return <div className="live-text-input" ref={root}>
    {focused && value.trim() && <div className={`live-text-panel${overlayStyle ? ' live-text-panel-overlay' : ''}`} style={overlayStyle}>
      {suggestionsEnabled && summary && <div className="live-text-preview">{summary}</div>}
      {message && <div role="alert" className="ui-field-error">{message}</div>}
      {expanded && <div id={`${id}-options`} role="listbox" aria-label="Подсказки Live text" className="live-text-options">
        {suggestions.options.map((option, index) => <div key={`${index}-${option.label}`} id={`${id}-option-${index}`} role="option" aria-selected={selected === index} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(index)}><strong>{option.label}</strong><small>{option.detail}</small></div>)}
      </div>}
      <Button size="compact" variant="ghost" onPointerDown={(event) => event.preventDefault()} onClick={() => { setReport({ input: value, parsed, referenceTime: referenceTime.toISOString() }); setExpected(''); setReportError(''); }}>Сообщить о неточности</Button>
      {notice && <small role="status">{notice}</small>}
    </div>}
    {multiline ? <Textarea {...common} ref={textarea} rows={4} /> : <Input {...common} ref={inputRef ?? ownInput} enterKeyHint="done" />}
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
