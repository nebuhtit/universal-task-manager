import { useRef, useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Button, Input } from '../../../../components/ui/primitives';
import { UserDataText } from '../../../../i18n-react';
import './organization-combobox.css';

export type OrganizationSuggestion = { value: string; meta?: string };

/** One searchable, creatable control for both single and multiple organization values. */
export function OrganizationCombobox({ label, placeholder, draft, values, suggestions, multiple = true, colorForValue, onDraft, onValuesChange }: {
  label: string; placeholder: string; draft: string; values: string[]; suggestions: OrganizationSuggestion[];
  multiple?: boolean; colorForValue?: ((value: string) => string | undefined) | undefined;
  onDraft: (value: string) => void; onValuesChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const highlighted = useRef<string | undefined>(undefined);
  const cleanDraft = draft.trim().replace(label === 'Add Tag' ? /^#+/ : /^$/, '');
  const query = cleanDraft.toLocaleLowerCase();
  const existing = suggestions.find(option => option.value.toLocaleLowerCase() === query);
  const options = suggestions.filter(option => option.value.toLocaleLowerCase().includes(query));
  if (cleanDraft && !existing) options.push({ value: cleanDraft });
  const choose = (next: string[]) => { onValuesChange(next); if (multiple) onDraft(''); setOpen(false); };
  return <Combobox.Root<string, boolean> multiple={multiple} modal={false} value={multiple ? values : values[0] ?? null}
    items={options.map(option => option.value)} filter={null} inputValue={draft} open={open} onOpenChange={setOpen}
    onInputValueChange={onDraft} onItemHighlighted={value => { highlighted.current = value; }}
    onValueChange={value => choose(Array.isArray(value) ? value : value ? [value] : [])}>
    <Combobox.InputGroup className="organization-combobox-control">
      <Combobox.Input render={<Input />} aria-label={label} placeholder={placeholder} onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && !open) { event.preventBaseUIHandler(); return; }
        if ((event.key === 'Enter' && highlighted.current === undefined) || (multiple && event.key === ',')) {
          event.preventBaseUIHandler(); event.preventDefault(); event.stopPropagation();
          const value = existing?.value ?? cleanDraft;
          if (value) choose(multiple ? [...new Set([...values, value])] : [value]);
          setOpen(false);
        } else if (multiple && event.key === 'Backspace' && !draft && values.length) {
          event.preventBaseUIHandler(); event.preventDefault(); onValuesChange(values.slice(0, -1));
        }
      }} />
      <Combobox.Trigger render={<Button variant="ghost" size="compact" />} aria-label="Show options" tabIndex={-1}>⌄</Combobox.Trigger>
    </Combobox.InputGroup>
    <Combobox.Portal>
      <Combobox.Positioner className="organization-combobox-positioner" sideOffset={4}>
        <Combobox.Popup className="organization-combobox-popup">
          <Combobox.Empty className="organization-combobox-empty">Type to create a new value</Combobox.Empty>
          <Combobox.List aria-label={label}>
            {options.map(option => <Combobox.Item key={option.value} value={option.value} className="organization-combobox-option">
              <Combobox.ItemIndicator>✓</Combobox.ItemIndicator>
              <UserDataText><span style={{ color: colorForValue?.(option.value) }}>{option.value}</span></UserDataText>
              {option.meta && <small><UserDataText>{option.meta}</UserDataText></small>}
              {option.value === cleanDraft && !existing && <span aria-hidden="true">＋</span>}
            </Combobox.Item>)}
          </Combobox.List>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  </Combobox.Root>;
}
