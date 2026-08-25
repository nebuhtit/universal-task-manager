import { useEffect } from 'react';

type UiSoundKind = 'click' | 'confirm' | 'dismiss' | 'toggle' | 'expand' | 'reset';
const playUiSound = (kind: UiSoundKind) => {
  try {
    const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return;
    const context = new Audio(); const oscillator = context.createOscillator(); const gain = context.createGain();
    const [start, end, duration] = kind === 'confirm' ? [560, 760, .11] : kind === 'dismiss' ? [420, 300, .09] : kind === 'reset' ? [360, 220, .14] : kind === 'toggle' ? [620, 700, .07] : kind === 'expand' ? [480, 620, .08] : [500, 540, .045];
    oscillator.type = kind === 'click' || kind === 'toggle' ? 'sine' : 'triangle'; oscillator.frequency.setValueAtTime(start, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(end, context.currentTime + duration);
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(kind === 'click' ? .018 : .028, context.currentTime + .006); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration + .01); oscillator.onended = () => void context.close();
  } catch { /* Interface sound is optional and must never block an action. */ }
};

export function useUiSounds(enabled: boolean | undefined) {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest('button,summary,select,input[type="checkbox"],input[type="radio"],[role="button"]') as HTMLElement | null;
      if (!control || (control as HTMLButtonElement).disabled || control.dataset.sound === 'none') return;
      const label = `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''}`.toLowerCase();
      const kind: UiSoundKind = /reset/.test(label) ? 'reset' : /delete|remove|cancel|close|dismiss|clear|lock/.test(label) ? 'dismiss' : /details|expand|collapse|section|recurrence/.test(label) ? 'expand' : /checkbox|toggle|sound|theme|language|select/.test(label) ? 'toggle' : /save|apply|add|create|enable|import|restore|backup|complete/.test(label) ? 'confirm' : 'click';
      playUiSound(kind);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [enabled]);
}
