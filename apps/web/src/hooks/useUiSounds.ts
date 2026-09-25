import { useEffect } from 'react';

type UiSoundKind = 'click' | 'confirm' | 'dismiss' | 'toggle' | 'expand' | 'reset';
let sharedAudioContext: AudioContext | undefined;

const nativeSound = (kind: UiSoundKind | 'completion' | 'interval') => {
  const bridge = (window as typeof window & { webkit?: { messageHandlers?: { utmNativeSound?: { postMessage: (kind: string) => void } } } }).webkit?.messageHandlers?.utmNativeSound;
  if (!bridge) return false;
  try { bridge.postMessage(kind); return true; } catch { return false; }
};

const resumeAudio = (context: AudioContext) => {
  // Safari can report "interrupted" after a call, lock, or app switch.
  if (context.state !== 'running' && context.state !== 'closed') void context.resume().catch(() => undefined);
};

const audioContext = () => {
  const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Audio) return undefined;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') sharedAudioContext = new Audio();
  resumeAudio(sharedAudioContext);
  return sharedAudioContext;
};

/**
 * Unlocks Web Audio while the user is still pressing Start. On iPhone, merely
 * constructing/resuming AudioContext is not reliably enough: a source has to
 * start inside the gesture or a later timer alarm can be silent.
 */
export const prepareTimerAlarm = () => {
  try {
    const context = audioContext();
    if (!context) return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, context.currentTime);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .02);
  } catch { /* Optional audio. */ }
};

/** Repeats a short, bright chime until the user explicitly stops it. */
export function startTimerAlarm(enabled = true): () => void {
  if (!enabled) return () => undefined;
  try {
    const context = audioContext();
    if (!context) return () => undefined;
    const voices = new Set<{ tone: OscillatorNode; gain: GainNode }>();
    const playPhrase = () => {
      if (stopped) return;
      try {
        const start = context.currentTime;
        for (const [index, frequency] of [660, 830, 990, 830].entries()) {
          const tone = context.createOscillator(); const gain = context.createGain();
          const at = start + index * .19;
          tone.type = 'triangle'; tone.frequency.setValueAtTime(frequency, at);
          gain.gain.setValueAtTime(.0001, at);
          gain.gain.exponentialRampToValueAtTime(.065, at + .018);
          gain.gain.exponentialRampToValueAtTime(.0001, at + .16);
          tone.connect(gain).connect(context.destination);
          const voice = { tone, gain }; voices.add(voice);
          tone.onended = () => { voices.delete(voice); tone.disconnect(); gain.disconnect(); };
          tone.start(at); tone.stop(at + .17);
        }
      } catch { /* Audio is optional; keep the timer usable if the device interrupts it. */ }
    };
    let stopped = false;
    playPhrase();
    const repeat = window.setInterval(playPhrase, 1_800);
    const recover = () => { if (!stopped && context.state !== 'running') { resumeAudio(context); playPhrase(); } };
    // Retry only for a live alarm, including a fresh user gesture after an OS interruption.
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('pageshow', recover);
    window.addEventListener('pointerdown', recover);
    window.addEventListener('keydown', recover);
    return () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(repeat);
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('pageshow', recover);
      window.removeEventListener('pointerdown', recover);
      window.removeEventListener('keydown', recover);
      for (const voice of voices) { try { voice.tone.stop(); } catch { /* Already stopped. */ } voice.tone.disconnect(); voice.gain.disconnect(); }
      voices.clear();
    };
  } catch { return () => undefined; }
}

/** A short, unobtrusive cue for optional timer intervals. */
export function playTimerIntervalSound(enabled = true): void {
  if (!enabled) return;
  if (nativeSound('interval')) return;
  try {
    const context = audioContext();
    if (!context) return;
    const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(520, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(460, context.currentTime + .16);
    gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.028, context.currentTime + .012); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .17);
    oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .18);
  } catch { /* Optional interval cue. */ }
}

const playUiSound = (kind: UiSoundKind) => {
  if (nativeSound(kind)) return;
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
  if (nativeSound('completion')) return;
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
