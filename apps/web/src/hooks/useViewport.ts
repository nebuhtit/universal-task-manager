import { useEffect, type RefObject } from 'react';

export function useViewport(captureInputRef: RefObject<HTMLInputElement | null>, ready: boolean) {
  useEffect(() => { if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'; }, []);
  useEffect(() => {
    if (!ready) return;
    const reset = () => { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; };
    reset(); const frame = window.requestAnimationFrame(reset); const timer = window.setTimeout(reset, 120);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [ready]);
  useEffect(() => {
    const viewport = window.visualViewport; if (!viewport) return;
    const update = () => { const focused = document.activeElement === captureInputRef.current; const height = focused ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0; document.documentElement.style.setProperty('--keyboard-offset', `${height}px`); document.documentElement.classList.toggle('capture-keyboard-open', focused && height > 80); };
    const release = () => { document.documentElement.classList.remove('capture-keyboard-open'); document.documentElement.style.setProperty('--keyboard-offset', '0px'); };
    const focusIn = (event: FocusEvent) => { if (event.target === captureInputRef.current) window.requestAnimationFrame(update); };
    const focusOut = (event: FocusEvent) => { if (event.target === captureInputRef.current) release(); };
    document.addEventListener('focusin', focusIn); document.addEventListener('focusout', focusOut); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update); update();
    return () => { document.removeEventListener('focusin', focusIn); document.removeEventListener('focusout', focusOut); viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); release(); document.documentElement.style.removeProperty('--keyboard-offset'); };
  }, [captureInputRef]);
}
