import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '../../../../components/ui/primitives';
import { parseFriendlyDurationInput, type FriendlyDurationUnit, type ReminderDurationUnit } from '../../../../utils/durations';
import './duration-input.css';

export type DurationValue = { amount: number; unit: FriendlyDurationUnit };
type CalendarDurationValue = { amount: number; unit: ReminderDurationUnit };
const suffix: Record<ReminderDurationUnit, string> = { seconds: 'sec', minutes: 'min', hours: 'h', days: 'd', weeks: 'wk', months: 'mo', years: 'yr' };
const units: FriendlyDurationUnit[] = ['seconds', 'minutes', 'hours', 'days', 'weeks'];
type DurationInputProps = {
  defaultUnit?: FriendlyDurationUnit; label: string; disabled?: boolean; allowZero?: boolean; showUnit?: boolean; presets?: boolean;
} & ({ calendarUnits?: false; duration?: DurationValue | undefined; onChange: (value: DurationValue | undefined) => void }
  | { calendarUnits: true; duration?: CalendarDurationValue | undefined; onChange: (value: CalendarDurationValue | undefined) => void });

/** Suggestions stay inside the dialog and do not move action buttons on blur. */
export function DurationInput(props: DurationInputProps) {
  const { duration, defaultUnit = 'minutes', label, disabled, allowZero = false, showUnit = true, presets = false } = props;
  const emit = (next: CalendarDurationValue | undefined) => {
    if (props.calendarUnits) props.onChange(next);
    else if (!next) props.onChange(undefined);
    else if (next.unit !== 'months' && next.unit !== 'years') props.onChange({ amount: next.amount, unit: next.unit });
  };
  const unit = duration?.unit ?? defaultUnit;
  const display = (next?: CalendarDurationValue) => next ? `${next.amount}${showUnit ? ` ${suffix[next.unit]}` : ''}` : '';
  const [value, setValue] = useState(display(duration));
  const latestValue = useRef(value);
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState(false);
  const editing = useRef(false);
  const inputUnit = useRef(unit);
  const pressed = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressPointerClick = useRef(false);
  const updateValue = (next: string) => { latestValue.current = next; setValue(next); };
  useEffect(() => { if (!editing.current) updateValue(display(duration)); }, [duration?.amount, duration?.unit, showUnit]);
  useEffect(() => {
    // A release outside the preset must not leave a pending press blocking blur.
    const cancelOutsidePress = (event: PointerEvent) => {
      if (pressed.current?.id !== event.pointerId) return;
      pressed.current = null; suppressPointerClick.current = true;
      if (!input.current?.parentElement?.contains(document.activeElement)) {
        editing.current = false; setFocused(false);
        updateValue(display(duration));
      }
    };
    document.addEventListener('pointerup', cancelOutsidePress);
    document.addEventListener('pointercancel', cancelOutsidePress);
    return () => {
      document.removeEventListener('pointerup', cancelOutsidePress);
      document.removeEventListener('pointercancel', cancelOutsidePress);
    };
  }, [duration?.amount, duration?.unit, showUnit]);
  const parse = (text: string) => {
    if (props.calendarUnits) {
      const match = /^\s*(\d+)\s*(mo|month|months|мес|месяц|месяца|месяцев|yr|year|years|г|год|года|лет)?\s*$/iu.exec(text);
      const fallback = inputUnit.current;
      if (match && (match[2] || fallback === 'months' || fallback === 'years')) {
        const amount = Number(match[1]);
        const unit: ReminderDurationUnit = match[2] ? /^(mo|month|months|мес|месяц|месяца|месяцев)$/iu.test(match[2]) ? 'months' : 'years' : fallback;
        return Number.isSafeInteger(amount) && (amount > 0 || allowZero) ? { amount, unit } : undefined;
      }
    }
    const fallbackUnit = inputUnit.current === 'months' || inputUnit.current === 'years' ? 'minutes' : inputUnit.current;
    if (allowZero && /^\s*0\s*[\p{L}]*\s*$/u.test(text)) {
      const parsed = parseFriendlyDurationInput(text.replace('0', '1'), fallbackUnit);
      if (parsed) return { ...parsed, amount: 0 };
    }
    return parseFriendlyDurationInput(text, fallbackUnit);
  };
  const commit = (next: string) => {
    updateValue(next);
    if (!next.trim()) emit(undefined);
    else { const parsed = parse(next); if (parsed) emit(parsed); }
  };
  const number = /^\s*(\d+(?:[.,]\d+)?)\s*[\p{L}]*\s*$/u.exec(value)?.[1];
  const choices = presets && (!typed || !value.trim())
    ? ['5 min', '10 min', '15 min', '30 min', '45 min', '1 h', '2 h', '3 h', '5 h']
    : [...units, ...(props.calendarUnits ? ['months', 'years'] as const : [])].map(nextUnit => `${number ?? '1'} ${suffix[nextUnit]}`);
  return <div className="duration-input" onFocus={() => setFocused(true)} onBlur={(event) => {
    if (event.currentTarget.contains(event.relatedTarget) || pressed.current) return;
    setFocused(false); editing.current = false;
    const parsed = parse(latestValue.current);
    if (parsed) {
      if (parsed.amount !== duration?.amount || parsed.unit !== duration?.unit) emit(parsed);
      updateValue(`${parsed.amount} ${suffix[parsed.unit]}`);
    } else updateValue(display(duration));
  }}>
    <Input ref={input} className="duration-amount" type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      aria-label={label} disabled={disabled} value={value} placeholder="1 h, 30 min" onFocus={() => { editing.current = true; inputUnit.current = unit; setTyped(false); }}
      onChange={(event) => { setTyped(true); commit(event.target.value); }} />
    {focused && !disabled && <div className="duration-input-suggestions" role="group" aria-label={`${label} units`}>
      {choices.map((choice) => <Button key={choice} size="compact" variant="ghost"
        // Complete a real press once, without relying on iOS's optional click
        // or the mouse-only button value of a touch/pen pointerup.
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          pressed.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          suppressPointerClick.current = false;
          event.preventDefault();
        }}
        onPointerUp={(event) => {
          const start = pressed.current; pressed.current = null;
          suppressPointerClick.current = true;
          if (!start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
          commit(choice);
          input.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => { if (suppressPointerClick.current && event.detail !== 0) { suppressPointerClick.current = false; return; } suppressPointerClick.current = false; commit(choice); }}>{choice}</Button>)}
    </div>}
  </div>;
}
