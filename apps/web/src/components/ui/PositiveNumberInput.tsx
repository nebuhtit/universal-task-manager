import { useState, type ComponentProps } from 'react';
import { Input } from './primitives';

/** Empty text is a valid editing state, not a request to immediately insert 1.
 * Only valid numbers reach the model; blur restores the last accepted value. */
export function PositiveNumberInput({ value, onValueChange, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur' | 'onFocus' | 'type'> & { value: number; onValueChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <Input {...props} type="number" min={1} value={draft ?? String(value)}
    onFocus={() => setDraft(String(value))} onBlur={() => setDraft(null)}
    onChange={event => {
      const text = event.target.value; setDraft(text);
      const amount = Number(text);
      if (text.trim() && Number.isFinite(amount) && amount >= 1) onValueChange(amount);
    }} />;
}
