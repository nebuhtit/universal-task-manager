import { useEffect } from 'react';

type UiSoundKind = 'click' | 'confirm' | 'dismiss' | 'toggle' | 'expand' | 'reset';
let sharedAudioContext: AudioContext | undefined;

const audioContext = () => {
  const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) return undefined;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') sharedAudioContext = new Audio();
  if (sharedAudioContext.state === 'suspended') void sharedAudioContext.resume();
  return sharedAudioContext;
};

const playUiSound = (kind: UiSoundKind) => {
  try {
    const context = audioContext();
    if (!context) return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    const [start, end, duration] = kind === 'confirm' ? [560, 760, .11] : kind === 'dismiss' ? [420, 300, .09] : kind === 'reset' ? [360, 220, .14] : kind === 'toggle' ? [620, 700, .07] : kind === 'expand' ? [480, 620, .08] : [500, 540, .045];
    oscillator.type = kind === 'click' || kind === 'toggle' ? 'sine' : 'triangle'; oscillator.frequency.setValueAtTime(start, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(end, context.currentTime + duration);
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(kind === 'click' ? .018 : .028, context.currentTime + .006); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + duration + .01);
  } catch { /* Interface sound is optional and must never block an action. */ }
};

const completionSoundPreviews = new Map<string, number>();
const playCompletionTone = () => {
  try {
    const context = audioContext();
    if (!context) return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(740, context.currentTime); oscillator.frequency.exponentialRampToValueAtTime(1040, context.currentTime + .07);
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.12, context.currentTime + .008); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .11);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .12);
  } catch { /* Sound is optional and must never block completing an item. */ }
};

export function previewCompletionSound(itemId: string, enabled: boolean | undefined): void {
  if (!enabled) return;
  const now = performance.now();
  const previousPreview = completionSoundPreviews.get(itemId);
  if (previousPreview !== undefined && now - previousPreview < 1_500) return;
  completionSoundPreviews.set(itemId, now);
  playCompletionTone();
}

export function playCompletionSoundUnlessPreviewed(itemId: string, enabled: boolean | undefined): void {
  if (!enabled) return;
  const previewedAt = completionSoundPreviews.get(itemId);
  completionSoundPreviews.delete(itemId);
  if (previewedAt !== undefined && performance.now() - previewedAt < 1_500) return;
  playCompletionTone();
}

export function useUiSounds(enabled: boolean | undefined) {
  useEffect(() => {
    if (!enabled) return;
    // A pointer can begin on a control and turn into a scroll or drag.  Sound
    // therefore follows the native click activation, not pointerdown.
    const onClick = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      audioContext();
      const target = event.target as HTMLElement | null;
      const control = target?.closest('button,summary,select,input[type="checkbox"],input[type="radio"],[role="button"]') as HTMLElement | null;
      if (!control || (control as HTMLButtonElement).disabled || control.dataset.sound === 'none') return;
      const label = `${control.getAttribute('aria-label') ?? ''} ${control.textContent ?? ''}`.toLowerCase();
      const kind: UiSoundKind = /reset/.test(label) ? 'reset' : /delete|remove|cancel|close|dismiss|clear|lock/.test(label) ? 'dismiss' : /details|expand|collapse|section|recurrence/.test(label) ? 'expand' : /checkbox|toggle|sound|theme|language|select/.test(label) ? 'toggle' : /save|apply|add|create|enable|import|restore|backup|complete/.test(label) ? 'confirm' : 'click';
      playUiSound(kind);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [enabled]);
}
