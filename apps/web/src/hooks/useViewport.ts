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
    const update = () => {
      const focused = document.activeElement === captureInputRef.current;
      const occluded = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const editable = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
      document.documentElement.classList.toggle('keyboard-open', Boolean(editable) && viewport.scale === 1 && occluded > 80);
      document.documentElement.style.setProperty('--keyboard-offset', `${focused ? occluded : 0}px`);
      document.documentElement.classList.toggle('capture-keyboard-open', focused && occluded > 80);
    };
    const release = () => { document.documentElement.classList.remove('capture-keyboard-open', 'keyboard-open'); document.documentElement.style.setProperty('--keyboard-offset', '0px'); };
    const focusIn = () => { window.requestAnimationFrame(update); };
    const focusOut = () => { window.requestAnimationFrame(update); };
    document.addEventListener('focusin', focusIn); document.addEventListener('focusout', focusOut); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update); update();
    return () => { document.removeEventListener('focusin', focusIn); document.removeEventListener('focusout', focusOut); viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); release(); document.documentElement.style.removeProperty('--keyboard-offset'); };
  }, [captureInputRef]);
}
