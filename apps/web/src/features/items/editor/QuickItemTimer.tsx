import { useEffect, useRef, useState } from 'react';
import { useClockMilliseconds } from '../../../hooks/useClock';
import { prepareTimerAlarm, startTimerAlarm } from '../../../hooks/useUiSounds';
import { Button, Input, Select } from '../../../components/ui/primitives';
import type { ItemTimerSession } from '@utm/core';
import './quick-item-timer.css';

type TimerMode = 'timer' | 'stopwatch';

const formatClock = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

export function QuickItemTimer({ soundEnabled = true, onRecord }: { soundEnabled?: boolean; onRecord?: (session: ItemTimerSession) => void }) {
  const [mode, setMode] = useState<TimerMode>('timer');
  const [minutes, setMinutes] = useState(10);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsedBeforeStart, setElapsedBeforeStart] = useState(0);
  const [alarming, setAlarming] = useState(false);
  const stopAlarmRef = useRef<() => void>(() => undefined);
  const now = useClockMilliseconds(250, running);
  const elapsed = elapsedBeforeStart + (running ? Math.max(0, now - startedAt) : 0);
  const duration = Math.max(1, minutes) * 60_000;
  const remaining = Math.max(0, duration - elapsed);
  const finished = mode === 'timer' && elapsed >= duration;

  useEffect(() => {
    if (!running || !finished) return;
    record(duration);
    setElapsedBeforeStart(duration);
    setRunning(false);
    stopAlarmRef.current();
    stopAlarmRef.current = startTimerAlarm(soundEnabled);
    setAlarming(soundEnabled);
  }, [duration, finished, running]);

  useEffect(() => () => stopAlarmRef.current(), []);

  const stopAlarm = () => { stopAlarmRef.current(); stopAlarmRef.current = () => undefined; setAlarming(false); };
  const record = (durationMilliseconds: number, endedAt = Date.now()) => {
    if (!onRecord || durationMilliseconds < 1_000) return;
    onRecord({
      id: crypto.randomUUID(), mode, startedAt: new Date(Math.max(0, endedAt - durationMilliseconds)).toISOString(), endedAt: new Date(endedAt).toISOString(),
      durationSeconds: Math.round(durationMilliseconds / 1_000), ...(mode === 'timer' ? { targetSeconds: Math.max(1, minutes) * 60 } : {}),
    });
  };
  const reset = () => { stopAlarm(); setRunning(false); setStartedAt(0); setElapsedBeforeStart(0); };
  const changeMode = (next: TimerMode) => { setMode(next); reset(); };
  const toggle = () => {
    prepareTimerAlarm();
    stopAlarm();
    if (finished) { setElapsedBeforeStart(0); setStartedAt(Date.now()); setRunning(true); return; }
    if (running) { if (mode === 'stopwatch') record(elapsed); setElapsedBeforeStart(elapsed); setRunning(false); return; }
    setStartedAt(Date.now()); setRunning(true);
  };

  return <section className="quick-item-timer" aria-label="Quick timer and stopwatch">
    <div className="quick-item-timer-controls">
      <Select aria-label="Quick timer mode" value={mode} onChange={(event) => changeMode(event.target.value as TimerMode)}>
        <option value="timer">Timer</option><option value="stopwatch">Stopwatch</option>
      </Select>
      {mode === 'timer' && <label><span>Minutes</span><Input aria-label="Timer minutes" type="number" min="1" step="1" value={minutes} onChange={(event) => { setMinutes(Math.max(1, Math.floor(Number(event.target.value) || 1))); reset(); }} /></label>}
    </div>
    <output aria-live={finished ? 'polite' : 'off'}>{formatClock(mode === 'timer' ? remaining : elapsed)}</output>
    <div className="quick-item-timer-actions">
      {alarming ? <Button size="compact" onClick={stopAlarm}>Stop sound</Button> : <Button size="compact" onClick={toggle}>{running ? 'Pause' : finished ? 'Restart' : 'Start'}</Button>}
      <Button size="compact" variant="ghost" disabled={!running && elapsedBeforeStart === 0} onClick={reset}>Reset</Button>
    </div>
  </section>;
}
