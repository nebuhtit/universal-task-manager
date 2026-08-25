import { useEffect, useState } from 'react';

export function useToast(timeoutMs = 3_500) {
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), timeoutMs); return () => window.clearTimeout(timer); }, [toast, timeoutMs]);
  return [toast, setToast] as const;
}
