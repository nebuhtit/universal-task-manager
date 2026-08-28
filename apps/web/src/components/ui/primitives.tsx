import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { PersistedDetails } from './PersistedDetails';

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ControlSize = 'compact' | 'default' | 'touch';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  type = 'button', variant = 'secondary', size = 'default', className, ...props
}, ref) {
  return <button ref={ref} type={type} className={classes('ui-button', className)} data-variant={variant} data-size={size} {...props} />;
});

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  'aria-label': string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  size = 'touch', className, ...props
}, ref) {
  return <Button ref={ref} size={size} className={classes('ui-icon-button', className)} {...props} />;
});

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, optional, children, className, ...props }: FieldProps) {
  const generatedId = useId();
  const candidate = isValidElement<Record<string, unknown>>(children) ? children : null;
  const control = candidate && (
    candidate.type === Input || candidate.type === Select || candidate.type === Textarea
    || (typeof candidate.type === 'string' && ['input', 'select', 'textarea'].includes(candidate.type))
  ) ? candidate : null;
  const controlId = htmlFor ?? (typeof control?.props.id === 'string' ? control.props.id : generatedId);
  const labelledChild = control && control.props.id === undefined ? cloneElement(control, { id: controlId }) : children;
  return <div className={classes('ui-field', className)} data-invalid={error ? 'true' : undefined} {...props}>
    <label className="ui-field-label" htmlFor={control ? controlId : htmlFor}>
      <span>{label}</span>
      {optional && <small>Optional</small>}
    </label>
    {labelledChild}
    {error ? <small className="ui-field-error">{error}</small> : hint ? <small className="ui-field-hint">{hint}</small> : null}
  </div>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={classes('ui-control', 'ui-input', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={classes('ui-control', 'ui-textarea', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return <select ref={ref} className={classes('ui-control', 'ui-select', className)} {...props}>{children}</select>;
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, className, ...props }, ref) {
  return <label className={classes('ui-checkbox', className)}>
    <input ref={ref} type="checkbox" {...props} />
    <span>{label}</span>
  </label>;
});

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'base' | 'muted' | 'elevated';
}

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface({ variant = 'base', className, ...props }, ref) {
  return <div ref={ref} className={classes('ui-surface', className)} data-variant={variant} {...props} />;
});

export interface DisclosureProps {
  uiKey: string;
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  persist?: boolean;
  className?: string;
}

export function Disclosure({ uiKey, summary, children, defaultOpen = false, persist = true, className }: DisclosureProps) {
  const [transientOpen, setTransientOpen] = useState(defaultOpen);
  if (!persist) return <details open={transientOpen} onToggle={(event) => setTransientOpen(event.currentTarget.open)} className={classes('ui-disclosure', className)}>
    <summary className="ui-disclosure-summary">{summary}</summary>
    <div className="ui-disclosure-content">{children}</div>
  </details>;
  return <PersistedDetails uiKey={uiKey} defaultOpen={defaultOpen} className={classes('ui-disclosure', className)}>
    <summary className="ui-disclosure-summary">{summary}</summary>
    <div className="ui-disclosure-content">{children}</div>
  </PersistedDetails>;
}
