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
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState(false);
  const editing = useRef(false);
  const inputUnit = useRef(unit);
  const suppressTouchClick = useRef(false);
  useEffect(() => { if (!editing.current) setValue(display(duration)); }, [duration?.amount, duration?.unit, showUnit]);
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
    setValue(next);
    if (!next.trim()) emit(undefined);
    else { const parsed = parse(next); if (parsed) emit(parsed); }
  };
  const number = /^\s*(\d+(?:[.,]\d+)?)\s*[\p{L}]*\s*$/u.exec(value)?.[1];
  const choices = presets && (!typed || !value.trim())
    ? ['10 min', '15 min', '30 min', '45 min', '1 h', '2 h', '3 h', '5 h']
    : [...units, ...(props.calendarUnits ? ['months', 'years'] as const : [])].map(nextUnit => `${number ?? '1'} ${suffix[nextUnit]}`);
  return <div className="duration-input" onFocus={() => setFocused(true)} onBlur={(event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setFocused(false); editing.current = false;
    const parsed = parse(value);
    if (parsed) {
      if (parsed.amount !== duration?.amount || parsed.unit !== duration?.unit) emit(parsed);
      setValue(`${parsed.amount} ${suffix[parsed.unit]}`);
    } else setValue(display(duration));
  }}>
    <Input className="duration-amount" type="text" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
      aria-label={label} disabled={disabled} value={value} placeholder="1 h, 30 min" onFocus={() => { editing.current = true; inputUnit.current = unit; setTyped(false); }}
      onChange={(event) => { setTyped(true); commit(event.target.value); }} />
    {focused && !disabled && <div className="duration-input-suggestions" role="group" aria-label={`${label} units`}>
      {choices.map((choice) => <Button key={choice} size="compact" variant="ghost"
        // Keep focus (and the mobile keyboard/visual viewport) stable while the
        // suggestion is tapped. iOS may suppress click when pointerdown is
        // canceled, so commit touch/pen on pointerup and reserve click for
        // mouse and keyboard activation.
        onPointerDown={(event) => { suppressTouchClick.current = false; event.preventDefault(); }}
        onPointerUp={(event) => {
          if (event.pointerType === 'mouse' || event.button !== 0) return;
          suppressTouchClick.current = true;
          commit(choice);
        }}
        onClick={(event) => { if (suppressTouchClick.current && event.detail !== 0) { suppressTouchClick.current = false; return; } suppressTouchClick.current = false; commit(choice); }}>{choice}</Button>)}
    </div>}
  </div>;
}
