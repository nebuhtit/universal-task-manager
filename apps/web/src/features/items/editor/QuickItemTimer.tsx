import { useEffect, useRef, useState } from 'react';
import { useClockMilliseconds } from '../../../hooks/useClock';
import { playTimerIntervalSound, prepareTimerAlarm, startTimerAlarm } from '../../../hooks/useUiSounds';
import { cancelNativeTimer, isNativeReminderAvailable, scheduleNativeTimer } from '../../../services/nativeReminders';
import { diagnosticFailureCode, recordDiagnostic } from '../../../services/diagnostics';
import { recordProfileSpan } from '../../../services/performanceProfile';
import { Button, Checkbox, Select } from '../../../components/ui/primitives';
import { calendarDurationMs } from '../../../utils/durations';
import { DurationInput, type DurationValue } from './fields/DurationInput';
import type { ItemTimerSession, UniversalItem } from '@utm/core';
import './quick-item-timer.css';

type TimerMode = 'timer' | 'stopwatch';
type RunningTimer = NonNullable<UniversalItem['activeTimer']>;

const formatClock = (milliseconds: number, includeMilliseconds = false) => {
  if (includeMilliseconds) {
    const safe = Math.max(0, Math.floor(milliseconds));
    const totalSeconds = Math.floor(safe / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    const prefix = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
    return `${prefix}.${String(safe % 1_000).padStart(3, '0')}`;
  }
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

export function QuickItemTimer({ expanded = false, soundEnabled = true, defaultDurationSeconds = 600, activeTimer, initialStopwatchStartedAt, timerTitle = 'Universal', onLegacyStop, onActiveTimerChange, onSaveCompletion }: { expanded?: boolean; soundEnabled?: boolean; defaultDurationSeconds?: number; activeTimer?: RunningTimer | undefined; initialStopwatchStartedAt?: string | undefined; timerTitle?: string; onLegacyStop?: () => void | Promise<void>; onActiveTimerChange?: (timer: RunningTimer | undefined) => void | Promise<void>; onSaveCompletion?: (session: ItemTimerSession) => void | Promise<void> }) {
  const savedStartedAt = activeTimer ? Date.parse(activeTimer.startedAt) : Number.NaN;
  const pendingSession = activeTimer?.stoppedAt && activeTimer.durationSeconds ? {
    id: activeTimer.id, mode: activeTimer.mode, startedAt: activeTimer.startedAt, endedAt: activeTimer.stoppedAt,
    durationSeconds: activeTimer.durationSeconds, ...(activeTimer.targetSeconds ? { targetSeconds: activeTimer.targetSeconds } : {}),
  } satisfies ItemTimerSession : undefined;
  const resumeSaved = Number.isFinite(savedStartedAt) && !pendingSession;
  const legacyStartedAt = initialStopwatchStartedAt ? Date.parse(initialStopwatchStartedAt) : Number.NaN;
  const resumeLegacy = !activeTimer && Number.isFinite(legacyStartedAt);
  const [recorded, setRecorded] = useState<ItemTimerSession | undefined>(pendingSession);
  const [counted, setCounted] = useState(false);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState('');
  const [notificationError, setNotificationError] = useState('');
  const [mode, setMode] = useState<TimerMode>(activeTimer?.mode ?? (resumeLegacy ? 'stopwatch' : 'timer'));
  const initialSeconds = activeTimer?.targetSeconds ?? defaultDurationSeconds;
  const [timerDuration, setTimerDuration] = useState<DurationValue>({ amount: initialSeconds % 60 === 0 ? initialSeconds / 60 : initialSeconds, unit: initialSeconds % 60 === 0 ? 'minutes' : 'seconds' });
  const minutesEdited = useRef(false);
  useEffect(() => {
    if (!minutesEdited.current && !activeTimer) setTimerDuration({ amount: defaultDurationSeconds % 60 === 0 ? defaultDurationSeconds / 60 : defaultDurationSeconds, unit: defaultDurationSeconds % 60 === 0 ? 'minutes' : 'seconds' });
  }, [defaultDurationSeconds, activeTimer]);
  const targetSeconds = Math.max(1, Math.round(calendarDurationMs(timerDuration.amount, timerDuration.unit) / 1000));
  const [running, setRunning] = useState(resumeSaved || resumeLegacy);
  const [startedAt, setStartedAt] = useState(resumeSaved ? savedStartedAt : resumeLegacy ? legacyStartedAt : 0);
  const [elapsedBeforeStart, setElapsedBeforeStart] = useState(pendingSession ? pendingSession.durationSeconds * 1_000 : 0);
  const [alarming, setAlarming] = useState(false);
  const [intervalSoundEnabled, setIntervalSoundEnabled] = useState(false);
  const [intervalDuration, setIntervalDuration] = useState<DurationValue>({ amount: 5, unit: 'minutes' });
  const intervalCueCountRef = useRef(0);
  const sessionIdRef = useRef<string | undefined>(activeTimer?.id ?? (resumeLegacy ? `legacy-stopwatch:${initialStopwatchStartedAt}` : undefined));
  const persistenceRef = useRef<Promise<void>>(Promise.resolve());
  const stopAlarmRef = useRef<() => void>(() => undefined);
  const nativeTimerIdRef = useRef<string | undefined>(activeTimer?.id);
  const cancelSystemTimer = () => { if (nativeTimerIdRef.current && isNativeReminderAvailable()) void cancelNativeTimer(nativeTimerIdRef.current).catch(() => undefined); nativeTimerIdRef.current = undefined; };
  const notifyFinished = () => {
    if (isNativeReminderAvailable() || !('Notification' in window) || Notification.permission !== 'granted') return;
    const title = `${timerTitle} · Timer finished`;
    if ('serviceWorker' in navigator) void navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, { tag: `timer:${sessionIdRef.current}` })).catch(() => new Notification(title));
    else new Notification(title);
  };
  const now = useClockMilliseconds(mode === 'stopwatch' ? 100 : 250, running);
  const elapsed = elapsedBeforeStart + (running ? Math.max(0, now - startedAt) : 0);
  const duration = targetSeconds * 1_000;
  const remaining = Math.max(0, duration - elapsed);
  const finished = mode === 'timer' && elapsed >= duration;
  const intervalMilliseconds = calendarDurationMs(intervalDuration.amount, intervalDuration.unit);

  useEffect(() => {
    if (!running || !intervalSoundEnabled || elapsed < intervalMilliseconds) return;
    const cueCount = Math.floor(elapsed / intervalMilliseconds);
    if (cueCount <= intervalCueCountRef.current) return;
    intervalCueCountRef.current = cueCount;
    playTimerIntervalSound(true);
  }, [elapsed, intervalMilliseconds, intervalSoundEnabled, running]);

  useEffect(() => {
    if (!running || !finished) return;
    const session = record(duration, startedAt + duration);
    setElapsedBeforeStart(duration);
    setRunning(false);
    if (session && isNativeReminderAvailable() && onSaveCompletion) {
      // Keep the durable running timer until history and its removal commit
      // together. A killed WebView can then reconcile it on the next launch.
      setCounting(true);
      const completionStarted = performance.now();
      persistenceRef.current = persistenceRef.current.then(() => onSaveCompletion({ ...session, automatic: true })).then(() => {
        setCounted(true);
        recordProfileSpan('timer.completion', performance.now() - completionStarted, { calls: 1 });
        recordDiagnostic({ kind: 'result', operation: 'Timer automatic completion', outcome: 'succeeded', message: 'Timer completion committed' });
      });
      void persistenceRef.current.catch(reason => {
        setCountError(String(reason));
        recordProfileSpan('timer.completion', performance.now() - completionStarted, { failed: 1 });
        recordDiagnostic({ kind: 'error', operation: 'Timer automatic completion', outcome: 'failed', message: 'Timer completion failed; running journal retained for recovery', details: diagnosticFailureCode(reason) });
      }).finally(() => setCounting(false));
    } else persistActive(session ? { id: session.id, mode: session.mode, startedAt: session.startedAt, stoppedAt: session.endedAt, durationSeconds: session.durationSeconds, ...(session.targetSeconds ? { targetSeconds: session.targetSeconds } : {}) } : undefined);
    stopAlarmRef.current();
    stopAlarmRef.current = startTimerAlarm(soundEnabled && !isNativeReminderAvailable());
    notifyFinished();
    setAlarming(soundEnabled && !isNativeReminderAvailable());
  }, [duration, finished, running]);

  useEffect(() => () => stopAlarmRef.current(), []);

  const stopAlarm = () => { stopAlarmRef.current(); stopAlarmRef.current = () => undefined; setAlarming(false); };
  const persistActive = (value: RunningTimer | undefined) => {
    const saveStarted = performance.now();
    // A new explicit action can retry after failure, but consumers of this
    // particular write must see rejection rather than assume it was saved.
    persistenceRef.current = persistenceRef.current.catch(() => undefined).then(() => onActiveTimerChange?.(value)).then(() => {
      recordProfileSpan('timer.state', performance.now() - saveStarted, { calls: 1 });
      recordDiagnostic({ kind: 'result', operation: 'Timer state save', outcome: 'succeeded', message: value ? 'Timer state accepted' : 'Timer state cleared' });
    });
    void persistenceRef.current.catch(reason => {
      recordProfileSpan('timer.state', performance.now() - saveStarted, { failed: 1 });
      setCountError(String(reason));
      recordDiagnostic({ kind: 'error', operation: 'Timer state save', outcome: 'failed', message: 'Timer state save failed', details: diagnosticFailureCode(reason) });
    });
  };
  const record = (durationMilliseconds: number, endedAt = Date.now()): ItemTimerSession | undefined => {
    if (durationMilliseconds <= 0) return undefined;
    const session: ItemTimerSession = {
      id: sessionIdRef.current ??= crypto.randomUUID(), mode, startedAt: new Date(Math.max(0, endedAt - durationMilliseconds)).toISOString(), endedAt: new Date(endedAt).toISOString(),
      durationSeconds: Math.max(1, Math.round(durationMilliseconds / 1_000)), ...(mode === 'timer' ? { targetSeconds } : {}),
    };
    setRecorded(session); setCounted(false);
    return session;
  };
  const endLegacy = () => { if (!resumeLegacy || !running) return; void Promise.resolve().then(onLegacyStop).catch((reason) => setCountError(String(reason))); };
  const reset = () => { endLegacy(); cancelSystemTimer(); persistActive(undefined); stopAlarm(); setRunning(false); setStartedAt(0); setElapsedBeforeStart(0); intervalCueCountRef.current = 0; sessionIdRef.current = undefined; setRecorded(undefined); setCounted(false); };
  const changeMode = (next: TimerMode) => { setMode(next); reset(); };
  const startFresh = () => {
    const timestamp = Date.now();
    const id = crypto.randomUUID();
    sessionIdRef.current = id;
    nativeTimerIdRef.current = id;
    setNotificationError('');
    if (mode === 'timer' && isNativeReminderAvailable()) void scheduleNativeTimer(id, `${timerTitle} · Timer finished`, new Date(timestamp + duration).toISOString())
      .catch((reason) => setNotificationError(reason instanceof Error ? reason.message : 'Could not schedule the system timer alarm.'));
    else if (mode === 'timer' && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission().then((permission) => { if (permission !== 'granted') setNotificationError('Allow notifications for a visible timer alert.'); });
    else if (mode === 'timer' && !('Notification' in window)) setNotificationError('System timer alerts are unavailable in this browser.');
    setRecorded(undefined); setCounted(false); setElapsedBeforeStart(0); setStartedAt(timestamp); setRunning(true);
    persistActive({ id, mode, startedAt: new Date(timestamp).toISOString(), ...(mode === 'timer' ? { targetSeconds } : {}) });
  };
  const toggle = () => {
    prepareTimerAlarm();
    stopAlarm();
    if (finished) { startFresh(); return; }
    if (running) {
      cancelSystemTimer();
      const pausedElapsed = elapsedBeforeStart + Math.max(0, Date.now() - startedAt);
      const session = record(pausedElapsed);
      endLegacy();
      persistActive(session ? { id: session.id, mode: session.mode, startedAt: session.startedAt, stoppedAt: session.endedAt, durationSeconds: session.durationSeconds, ...(session.targetSeconds ? { targetSeconds: session.targetSeconds } : {}) } : undefined);
      setElapsedBeforeStart(pausedElapsed); setRunning(false); return;
    }
    if (recorded) { startFresh(); return; }
    intervalCueCountRef.current = Math.floor(elapsed / intervalMilliseconds);
    startFresh();
  };

  return <details open={expanded || undefined} className="quick-item-timer" aria-label="Quick timer and stopwatch">
    <summary>Quick timer &amp; stopwatch</summary>
    <div className="quick-item-timer-body">
    <div className="quick-item-timer-controls">
      <Select aria-label="Quick timer mode" value={mode} onChange={(event) => changeMode(event.target.value as TimerMode)}>
        <option value="timer">Timer</option><option value="stopwatch">Stopwatch</option>
      </Select>
      {mode === 'timer' && <div className="quick-item-timer-duration"><span>Duration</span><DurationInput presets label="Timer minutes" showUnit duration={timerDuration} onChange={(next) => { if (next) { minutesEdited.current = true; setTimerDuration(next); reset(); } }} /></div>}
    </div>
    <output aria-live={finished ? 'polite' : 'off'}>{formatClock(mode === 'timer' ? remaining : elapsed, mode === 'stopwatch')}</output>
    <div className="quick-item-timer-interval">
      <Checkbox label="Interval sound" checked={intervalSoundEnabled} onChange={(event) => setIntervalSoundEnabled(event.target.checked)} />
      <DurationInput presets label="Interval sound value" duration={intervalDuration} disabled={!intervalSoundEnabled} showUnit onChange={(next) => { if (next) setIntervalDuration(next); }} />
    </div>
    <div className="quick-item-timer-actions">
      {!running && recorded && onSaveCompletion && <Button size="compact" variant="secondary" disabled={counted || counting} onClick={() => { setCounting(true); setCountError(''); persistenceRef.current = persistenceRef.current.catch(() => undefined).then(() => onSaveCompletion(recorded)).then(() => setCounted(true)); void persistenceRef.current.catch((reason) => setCountError(String(reason))).finally(() => setCounting(false)); }}>{counted ? 'Completion saved' : counting ? 'Saving…' : 'Save completion'}</Button>}
      {countError && <small role="alert">{countError}</small>}
      {notificationError && <small role="alert">{notificationError}</small>}
      {alarming ? <Button size="compact" onClick={stopAlarm}>Stop sound</Button> : <Button size="compact" onClick={toggle}>{running ? 'Stop' : finished || recorded ? 'Restart' : 'Start'}</Button>}
      <Button size="compact" variant="ghost" disabled={!running && elapsedBeforeStart === 0} onClick={reset}>Reset</Button>
    </div>
    </div>
  </details>;
}
