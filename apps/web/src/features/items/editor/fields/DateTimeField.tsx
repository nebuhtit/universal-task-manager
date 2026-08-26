import type { WorkspaceLanguage } from '@utm/core';
import { Button, Input } from '../../../../components/ui/primitives';
import { dateInput, formatViewDate, fromDateInput } from '../../../../utils/dates';

export function DateTimeField({ label, value, language, onChange, help, onFocus, minValue }: {
  label: string;
  value?: string | undefined;
  language?: WorkspaceLanguage | undefined;
  onChange: (value: string | undefined) => void;
  help?: string | undefined;
  onFocus?: (() => void) | undefined;
  minValue?: string | undefined;
}) {
  return <div className="date-field">
    <div className="date-field-row">
      <Input
        aria-label={label}
        type="datetime-local"
        value={dateInput(value)}
        min={minValue ? dateInput(minValue) : undefined}
        onFocus={onFocus}
        onChange={(event) => onChange(fromDateInput(event.currentTarget.value))}
      />
      <Button
        size="compact"
        variant="ghost"
        className="date-clear"
        aria-label={`Clear ${label}`}
        disabled={!value}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onChange(undefined); }}
      >Clear</Button>
    </div>
    {value && <small className="formatted-date">{formatViewDate(value, true, language)}</small>}
    {help && <small>{help}</small>}
  </div>;
}
