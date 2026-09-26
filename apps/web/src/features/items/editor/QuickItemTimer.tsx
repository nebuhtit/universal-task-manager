import { useEffect, useRef, useState } from 'react';
import { useClockMilliseconds } from '../../../hooks/useClock';
import { playTimerIntervalSound, prepareTimerAlarm, startTimerAlarm } from '../../../hooks/useUiSounds';
import { cancelNativeTimer, isNativeReminderAvailable, scheduleNativeTimer } from '../../../services/nativeReminders';
import { Button, Checkbox, Input, Select } from '../../../components/ui/primitives';
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
  const [minutesInput, setMinutesInput] = useState(String(Math.max(1, Math.ceil((activeTimer?.targetSeconds ?? defaultDurationSeconds) / 60))));
  const minutesEdited = useRef(false);
  useEffect(() => {
    if (!minutesEdited.current && !activeTimer) setMinutesInput(String(Math.max(1, Math.ceil(defaultDurationSeconds / 60))));
  }, [defaultDurationSeconds, activeTimer]);
  const minutes = Math.max(1, Math.floor(Number(minutesInput) || 1));
  const [running, setRunning] = useState(resumeSaved || resumeLegacy);
  const [startedAt, setStartedAt] = useState(resumeSaved ? savedStartedAt : resumeLegacy ? legacyStartedAt : 0);
  const [elapsedBeforeStart, setElapsedBeforeStart] = useState(pendingSession ? pendingSession.durationSeconds * 1_000 : 0);
  const [alarming, setAlarming] = useState(false);
  const [intervalSoundEnabled, setIntervalSoundEnabled] = useState(false);
  const [intervalValueInput, setIntervalValueInput] = useState('5');
  const intervalValue = Math.max(1, Math.floor(Number(intervalValueInput) || 1));
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'seconds'>('minutes');
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
  const duration = Math.max(1, minutes) * 60_000;
  const remaining = Math.max(0, duration - elapsed);
  const finished = mode === 'timer' && elapsed >= duration;
  const intervalMilliseconds = Math.max(1, intervalValue) * (intervalUnit === 'minutes' ? 60_000 : 1_000);

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
    persistActive(session ? { id: session.id, mode: session.mode, startedAt: session.startedAt, stoppedAt: session.endedAt, durationSeconds: session.durationSeconds, ...(session.targetSeconds ? { targetSeconds: session.targetSeconds } : {}) } : undefined);
    if (session && isNativeReminderAvailable() && onSaveCompletion) {
      setCounting(true);
      void persistenceRef.current.then(() => onSaveCompletion({ ...session, automatic: true })).then(() => setCounted(true)).catch(reason => setCountError(String(reason))).finally(() => setCounting(false));
    }
    stopAlarmRef.current();
    stopAlarmRef.current = startTimerAlarm(soundEnabled && !isNativeReminderAvailable());
    notifyFinished();
    setAlarming(soundEnabled && !isNativeReminderAvailable());
  }, [duration, finished, running]);

  useEffect(() => () => stopAlarmRef.current(), []);

  const stopAlarm = () => { stopAlarmRef.current(); stopAlarmRef.current = () => undefined; setAlarming(false); };
  const persistActive = (value: RunningTimer | undefined) => {
    persistenceRef.current = persistenceRef.current.then(() => onActiveTimerChange?.(value)).then(() => undefined).catch((reason) => setCountError(String(reason)));
  };
  const record = (durationMilliseconds: number, endedAt = Date.now()): ItemTimerSession | undefined => {
    if (durationMilliseconds <= 0) return undefined;
    const session: ItemTimerSession = {
      id: sessionIdRef.current ??= crypto.randomUUID(), mode, startedAt: new Date(Math.max(0, endedAt - durationMilliseconds)).toISOString(), endedAt: new Date(endedAt).toISOString(),
      durationSeconds: Math.max(1, Math.round(durationMilliseconds / 1_000)), ...(mode === 'timer' ? { targetSeconds: minutes * 60 } : {}),
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
    if (mode === 'timer' && isNativeReminderAvailable()) void scheduleNativeTimer(id, `${timerTitle} · Timer finished`, new Date(timestamp + Math.max(1, minutes) * 60_000).toISOString())
      .catch((reason) => setNotificationError(reason instanceof Error ? reason.message : 'Could not schedule the system timer alarm.'));
    else if (mode === 'timer' && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission().then((permission) => { if (permission !== 'granted') setNotificationError('Allow notifications for a visible timer alert.'); });
    else if (mode === 'timer' && !('Notification' in window)) setNotificationError('System timer alerts are unavailable in this browser.');
    setRecorded(undefined); setCounted(false); setElapsedBeforeStart(0); setStartedAt(timestamp); setRunning(true);
    persistActive({ id, mode, startedAt: new Date(timestamp).toISOString(), ...(mode === 'timer' ? { targetSeconds: Math.max(1, minutes) * 60 } : {}) });
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
      {mode === 'timer' && <label><span>Minutes</span><Input aria-label="Timer minutes" type="number" min="1" step="1" value={minutesInput} onChange={(event) => { minutesEdited.current = true; setMinutesInput(event.target.value); reset(); }} onBlur={() => setMinutesInput(String(minutes))} /></label>}
    </div>
    <output aria-live={finished ? 'polite' : 'off'}>{formatClock(mode === 'timer' ? remaining : elapsed, mode === 'stopwatch')}</output>
    <div className="quick-item-timer-interval">
      <Checkbox label="Interval sound" checked={intervalSoundEnabled} onChange={(event) => setIntervalSoundEnabled(event.target.checked)} />
      <Input aria-label="Interval sound value" type="number" min="1" step="1" value={intervalValueInput} disabled={!intervalSoundEnabled} onChange={(event) => setIntervalValueInput(event.target.value)} onBlur={() => setIntervalValueInput(String(intervalValue))} />
      <Select aria-label="Interval sound unit" value={intervalUnit} disabled={!intervalSoundEnabled} onChange={(event) => setIntervalUnit(event.target.value as 'minutes' | 'seconds')}><option value="minutes">min</option><option value="seconds">sec</option></Select>
    </div>
    <div className="quick-item-timer-actions">
      {!running && recorded && onSaveCompletion && <Button size="compact" variant="secondary" disabled={counted || counting} onClick={() => { setCounting(true); setCountError(''); void persistenceRef.current.then(() => onSaveCompletion(recorded)).then(() => setCounted(true)).catch((reason) => setCountError(String(reason))).finally(() => setCounting(false)); }}>{counted ? 'Completion saved' : counting ? 'Saving…' : 'Save completion'}</Button>}
      {countError && <small role="alert">{countError}</small>}
      {notificationError && <small role="alert">{notificationError}</small>}
      {alarming ? <Button size="compact" onClick={stopAlarm}>Stop sound</Button> : <Button size="compact" onClick={toggle}>{running ? 'Stop' : finished || recorded ? 'Restart' : 'Start'}</Button>}
      <Button size="compact" variant="ghost" disabled={!running && elapsedBeforeStart === 0} onClick={reset}>Reset</Button>
    </div>
    </div>
  </details>;
}
