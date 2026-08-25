import { useEffect, useState, type ReactNode } from 'react';

export function readUiBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  const value = window.localStorage.getItem(`utm-ui:${key}`);
  return value === null ? fallback : value === '1';
}

export function persistUiBoolean(key: string, value: boolean) {
  if (typeof window !== 'undefined') window.localStorage.setItem(`utm-ui:${key}`, value ? '1' : '0');
}

/** Keeps disclosure state stable across rerenders and visits. */
export function PersistedDetails({ uiKey, defaultOpen, className, children }: {
  uiKey: string; defaultOpen: boolean; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readUiBoolean(uiKey, defaultOpen));
  useEffect(() => { setOpen(readUiBoolean(uiKey, defaultOpen)); }, [uiKey]);
  useEffect(() => { persistUiBoolean(uiKey, open); }, [uiKey, open]);
  return <details className={className} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>{children}</details>;
}
