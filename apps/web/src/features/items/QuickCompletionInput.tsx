import { useRef } from 'react';
import { ResponsiveDialog } from '../../components/ui/ResponsiveDialog';
import { Button, Field, Input } from '../../components/ui/primitives';
import './quick-completion-input.css';

export interface QuickCompletionInputProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  onEditItem: () => void;
}

export function QuickCompletionInput({ open, value, onChange, onClose, onConfirm, onEditItem }: QuickCompletionInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const valid = Boolean(value) && !Number.isNaN(new Date(value).getTime());
  return <ResponsiveDialog
    open={open}
    onOpenChange={(next) => { if (!next) onClose(); }}
    title={<span className="sr-only">Choose completion time</span>}
    ariaLabel="Choose completion time"
    className="quick-completion-input"
    initialFocus={inputRef}
    footer={<>
      <Button size="touch" onClick={onEditItem}>Edit item</Button>
      <Button size="touch" variant="primary" disabled={!valid} onClick={onConfirm}>OK</Button>
    </>}
  >
    <Field label="Completed at">
      <Input ref={inputRef} type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  </ResponsiveDialog>;
}
