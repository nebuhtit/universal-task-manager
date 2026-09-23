import type { WorkspaceLanguage } from '@utm/core';
import { Button, Input } from '../../../../components/ui/primitives';
import { dateInput, formatViewDate, fromDateInput } from '../../../../utils/dates';
import { dueWallInput, dueWallInputToIso } from '../../dueQuickActions';

export function DateTimeField({ label, value, language, onChange, onClear, canClear, help, onFocus, minValue, timeZone }: {
  label: string;
  value?: string | undefined;
  language?: WorkspaceLanguage | undefined;
  onChange: (value: string | undefined) => void;
  onClear?: (() => void) | undefined;
  canClear?: boolean | undefined;
  help?: string | undefined;
  onFocus?: (() => void) | undefined;
  minValue?: string | undefined;
  timeZone?: string | undefined;
}) {
  const inputValue = value ? (timeZone ? dueWallInput(value, timeZone) : dateInput(value)) : '';
  const minInput = minValue ? (timeZone ? dueWallInput(minValue, timeZone) : dateInput(minValue)) : undefined;
  return <div className="date-field">
    <div className="date-field-row">
      <Input
        aria-label={label}
        type="datetime-local"
        value={inputValue}
        min={minInput}
        onFocus={onFocus}
        onChange={(event) => onChange(timeZone ? dueWallInputToIso(event.currentTarget.value, timeZone) : fromDateInput(event.currentTarget.value))}
      />
      <Button
        size="compact"
        variant="ghost"
        className="date-clear"
        aria-label={`Clear ${label}`}
        disabled={canClear === undefined ? !value : !canClear}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (onClear) onClear(); else onChange(undefined); }}
      >Clear</Button>
    </div>
    {value && <small className="formatted-date">{formatViewDate(value, true, language)}</small>}
    {help && <small className="ui-field-hint">{help}</small>}
  </div>;
}
