import { useEffect, type RefObject } from 'react';

export function useViewport(captureInputRef: RefObject<HTMLInputElement | null>, ready: boolean) {
  useEffect(() => { if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'; }, []);
  useEffect(() => {
    if (!ready) return;
    const dock = document.querySelector('.capture-dock');
    if (dock) document.documentElement.style.setProperty('--capture-dock-bottom', getComputedStyle(dock).bottom);
    const reset = () => { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); document.documentElement.scrollTop = 0; document.body.scrollTop = 0; };
    reset(); const frame = window.requestAnimationFrame(reset); const timer = window.setTimeout(reset, 120);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [ready]);
  useEffect(() => {
    const viewport = window.visualViewport; if (!viewport) return;
    let restingHeight = window.innerHeight;
    let nativeOpen = document.documentElement.dataset.nativeKeyboardOpen === 'true';
    let closingTimer: number | undefined;
    let captureWasFocused = false;
    const update = () => {
      const focused = document.activeElement === captureInputRef.current;
      const occluded = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const editable = document.activeElement?.matches('input, textarea, [contenteditable="true"]');
      const nativeKnown = document.documentElement.dataset.nativeKeyboardOpen !== undefined;
      const keyboardOpen = nativeKnown ? nativeOpen : (Boolean(editable) && viewport.scale === 1 && Math.max(occluded, restingHeight - viewport.height) > 80);
      if (!editable && !nativeOpen) restingHeight = window.innerHeight;
      window.clearTimeout(closingTimer);
      if (keyboardOpen) {
        captureWasFocused ||= focused;
        document.documentElement.classList.add('keyboard-open');
        document.documentElement.classList.toggle('capture-keyboard-open', captureWasFocused);
      } else {
        // iOS sends blur, native frame and visualViewport events at different
        // points in its dismissal animation. Restore the row once it settles.
        const close = () => {
          captureWasFocused = false;
          document.documentElement.classList.remove('keyboard-open', 'capture-keyboard-open');
        };
        if (nativeKnown) close();
        else closingTimer = window.setTimeout(close, 180);
      }
      document.documentElement.style.setProperty('--keyboard-offset', `${focused ? occluded : 0}px`);
    };
    const release = () => { window.clearTimeout(closingTimer); document.documentElement.classList.remove('capture-keyboard-open', 'keyboard-open'); document.documentElement.style.setProperty('--keyboard-offset', '0px'); };
    const focusIn = () => {
      const dock = document.querySelector('.capture-dock');
      if (dock && !document.documentElement.classList.contains('keyboard-open')) {
        // Freeze the resting inset before iOS changes its viewport/safe area.
        document.documentElement.style.setProperty('--capture-dock-bottom', getComputedStyle(dock).bottom);
      }
      window.requestAnimationFrame(update);
    };
    const focusOut = () => { window.requestAnimationFrame(update); };
    const nativeKeyboard = () => { nativeOpen = document.documentElement.dataset.nativeKeyboardOpen === 'true'; update(); };
    window.addEventListener('utm:native-keyboard', nativeKeyboard);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', focusIn); document.addEventListener('focusout', focusOut); viewport.addEventListener('resize', update); viewport.addEventListener('scroll', update); update();
    return () => { window.removeEventListener('utm:native-keyboard', nativeKeyboard); window.removeEventListener('resize', update); document.removeEventListener('focusin', focusIn); document.removeEventListener('focusout', focusOut); viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); release(); document.documentElement.style.removeProperty('--keyboard-offset'); };
  }, [captureInputRef]);
}
