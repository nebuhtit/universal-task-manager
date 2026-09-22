import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Button, Input, Textarea, Surface, Disclosure } from '../src/components/ui/primitives';
import { examples, parseEntry, suggest, type Draft } from './parser';
import '../src/styles/tokens.css';
import '../src/styles/base.css';
import '../src/components/ui/primitives.css';
import './style.css';

const format = (value: string | null) => !value ? 'Не задано' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.split('-').reverse().join('.')} · без времени` : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const duration = (minutes: number | null) => minutes === null ? 'Не задано' : `${minutes} мин`;
function Preview({ draft }: { draft: Draft }) {
  return <div className="preview"><h2>{draft.title || 'Название появится здесь'}</h2><dl>
    {([['Due · срок', format(draft.due)], ['Event opens · начало', format(draft.start)], ['Дорога', duration(draft.travelMinutes)], ['Выезд', format(draft.leave)], ['Длительность', duration(draft.durationMinutes)], ['Event ends · окончание', format(draft.end)]]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl><h3>Напоминания</h3>{draft.reminders.length ? <ul>{draft.reminders.map((r, i) => <li key={i}><strong>{format(r.at)}</strong><small>{r.anchor === 'now' ? `Через ${r.minutes} мин от создания` : `За ${-r.minutes} мин до ${r.anchor === 'leave' ? 'выезда' : r.anchor === 'due' ? 'due' : 'event opens'}`}{r.automatic && ' · автоматически'}</small></li>)}</ul> : <p className="muted">Не заданы</p>}</div>;
}
function App() {
  const [text, setText] = useState(examples[0]!);
  const [now, setNow] = useState(() => new Date());
  const [caret, setCaret] = useState(0), [open, setOpen] = useState(false), [selected, setSelected] = useState(0);
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const [cards, setCards] = useState<Draft[]>([]), [notice, setNotice] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current !== null) { input.current?.focus(); input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current); pendingCaret.current = null; }
  }, [text]);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const calendarInput = useRef<HTMLInputElement>(null);
  const calendarEdit = useRef<{ start: number; end: number; insert: string; source: string } | null>(null);
  const suggestions = suggest(text, caret, now), options = suggestions.options;
  const expanded = open && options.length > 0;
  const active = Math.min(selected, options.length - 1);
  const draft = parseEntry(text, now);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { document.getElementById(`suggestion-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  function choose(index: number) {
    const option = options[index]; if (!option) return;
    if (option.calendar) {
      calendarEdit.current = { start: suggestions.start, end: suggestions.end, insert: option.insert, source: text };
      flushSync(() => { setOpen(false); setCalendarVisible(true); }); calendarInput.current?.focus();
      try { calendarInput.current?.showPicker(); } catch { /* Native date field remains available. */ }
      return;
    }
    const next = text.slice(0, suggestions.start) + option.insert + text.slice(suggestions.end);
    const position = suggestions.start + option.insert.length;
    pendingCaret.current = position; setText(next); setCaret(position); setSelected(0); setOpen(/^(?:срок|начало|конец|дорога|длительность|напомнить|event opens|event ends|след) $/.test(option.insert));

  }
  function load(value: string) { pendingCaret.current = value.length; setText(value); setNow(new Date()); setCaret(value.length); setOpen(false); setNotice(''); input.current?.focus(); }
  function capture() {
    const at = new Date(), snapshot = parseEntry(text, at); setNow(at);
    if (snapshot.errors.length) return;
    setCards(previous => [snapshot, ...previous]); setNotice('Тестовая карточка добавлена. В UTM ничего не записано.'); setOpen(false);
  }
  return <main>
    <header><div><p className="eyebrow">UTM / ЭКСПЕРИМЕНТ</p><h1>Задача одной строкой</h1><p className="muted">Пишите, выбирайте подсказки и сразу проверяйте результат.</p></div><Button onClick={() => setDark(!dark)} aria-pressed={dark}>Тёмная тема</Button></header>
    <div className="workspace"><Surface className="entry"><label htmlFor="entry">Что запланируем?</label>
      <Textarea id="entry" ref={input} value={text} rows={4} maxLength={2000} autoComplete="off" spellCheck={false}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls="suggestions" aria-activedescendant={expanded ? `suggestion-${active}` : undefined} aria-describedby="entry-help"
        onChange={event => { setText(event.target.value); setCaret(event.target.selectionStart); setOpen(true); setSelected(0); setNotice(''); }}
        onClick={event => { setCaret(event.currentTarget.selectionStart); setOpen(true); setSelected(0); }}
        onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { setCaret(event.currentTarget.selectionStart); setSelected(0); } }}
        onBlur={event => { if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest('.actions'))) setOpen(false); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { setOpen(false); return; }
          if (expanded && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
          else if (expanded && ['Enter', 'Tab'].includes(event.key)) { if (event.shiftKey && event.key === 'Tab') return; event.preventDefault(); choose(active); }
          else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); capture(); }
          else if (event.key === 'ArrowDown') { setOpen(true); setSelected(0); }
        }} />
      {expanded && <div id="suggestions" role="listbox" aria-label="Варианты ввода">{options.map((option, i) => <div key={option.label} id={`suggestion-${i}`} role="option" aria-selected={i === active} onPointerDown={event => event.preventDefault()} onClick={() => choose(i)}><strong>{option.label}</strong><small>{option.detail}</small></div>)}</div>}
      <div hidden={!calendarVisible}><label className="calendar-field">Дата в календаре<Input type="date" ref={calendarInput} aria-label="Дата в календаре" onChange={event => {
        const edit = calendarEdit.current;
        if (!edit || edit.source !== text || !event.target.value) return;
        const replacement = edit.insert.replace('__DATE__', event.target.value);
        const next = text.slice(0, edit.start) + replacement + text.slice(edit.end);
        pendingCaret.current = edit.start + replacement.length; setText(next); setCaret(edit.start + replacement.length); setOpen(false); setCalendarVisible(false); calendarEdit.current = null;

      }} /></label></div>
      <p id="entry-help" className="muted">↑ ↓ выбор · Tab / Enter вставить · Esc закрыть · Ctrl / ⌘ Enter добавить карточку</p>
      <div className="actions"><Button size="touch" variant="primary" disabled={Boolean(draft.errors.length)} onClick={capture}>Добавить тестовую карточку</Button><Button onClick={() => { setNow(new Date()); setNotice('Опорное время обновлено.'); }}>Обновить время</Button></div>
      <p className="muted clock">Отсчёт «завтра» и «через»: {format(now.toISOString())}<br />Часовой пояс: {Intl.DateTimeFormat().resolvedOptions().timeZone}. При добавлении время обновляется.</p>
      <div aria-live="polite">{draft.errors.length > 0 && <ul className="errors">{draft.errors.map(error => <li key={error}>{error}</li>)}</ul>}{draft.warnings.length > 0 && <ul className="warnings">{draft.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}</div>
      <p role="status">{notice}</p>
    </Surface><Surface className="result"><p className="eyebrow">ПРЕДПРОСМОТР</p><Preview draft={draft} /></Surface></div>
    <section><h2>Попробуйте примеры</h2><div className="examples">{examples.map((example, i) => <Button key={example} onClick={() => load(example)}><span className="example-number">0{i + 1}</span><span>{example}</span></Button>)}</div></section>
    <Disclosure uiKey="lab-help" summary="Синтаксис и правила" persist={false}><p>Название можно писать до, после или между командами. Двоеточия не нужны. Начните слово и выберите подсказку: «се» → «сегодня», «зав» → «завтра», «след» → следующая календарная неделя.</p><ul><li><code>Даша вс 15 00</code> — начало в воскресенье в 15:00, окончание в 16:00.</li><li><code>Домашнее задание до вс 15 00</code> — только due в 15:00, оценка 10 минут.</li><li><code>стрижка завтра 15:00 дорога 45м</code> — событие и время в пути.</li><li><code>встреча с завтра 10:00 по завтра 11:00</code> — точные начало и конец.</li><li><code>напомнить 30м,2ч</code> — до начала, а при due без начала — до due.</li><li><code>напомнить выезд-1д,выезд-2ч</code> — до выезда; <code>напомнить через45м</code> — от текущего момента.</li></ul><p>Без указанного времени используется 09:00; «утром» — 07:00, «днём» — 11:00, «вечером» — 18:00, «ночью» — 21:00. Даты: сегодня, завтра, послезавтра, день недели, 25.09.2026 или 2026-09-25. Обычный день недели означает ближайший такой день, включая сегодня; «след» — день следующей календарной недели. Время берётся в часовом поясе браузера. Команды можно менять местами, а буквальные даты и команды в названии заключать в кавычки.</p></Disclosure>
    <Disclosure uiKey="lab-json" summary="Результат разбора (JSON)" persist={false}><pre>{JSON.stringify(draft, null, 2)}</pre></Disclosure>
    {cards.length > 0 && <section aria-label="Тестовые карточки"><div className="section-title"><h2>Тестовые карточки · {cards.length}</h2><Button onClick={() => { setCards([]); setNotice('Тестовые карточки очищены.'); }}>Очистить карточки</Button></div><div className="cards">{cards.map((card, i) => <Surface key={i}><Preview draft={card} /></Surface>)}</div></section>}
    <footer>Локальный прототип · без AI и новых зависимостей. Карточки исчезнут после перезагрузки; уведомления не отправляются.<br />Незакоммиченные изменения · база 452cb85 · версия UTM не изменена.</footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
