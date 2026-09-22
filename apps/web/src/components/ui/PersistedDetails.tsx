import { useEffect, useState, type ReactNode } from 'react';

export function readUiBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(`utm-ui:${key}`);
    return value === null ? fallback : value === '1';
  } catch { return fallback; }
}

export function persistUiBoolean(key: string, value: boolean) {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(`utm-ui:${key}`, value ? '1' : '0'); } catch { /* UI preferences must not prevent opening data. */ }
}

/** Keeps disclosure state stable across rerenders and visits. */
export function PersistedDetails({ uiKey, defaultOpen, className, children }: {
  uiKey: string; defaultOpen: boolean; className?: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readUiBoolean(uiKey, defaultOpen));
  useEffect(() => { setOpen(readUiBoolean(uiKey, defaultOpen)); }, [uiKey]);
  return <details className={className} open={open} onToggle={(event) => { const next = event.currentTarget.open; persistUiBoolean(uiKey, next); setOpen(next); }}>{children}</details>;
}
