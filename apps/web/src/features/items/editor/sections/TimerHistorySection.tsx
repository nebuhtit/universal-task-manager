import type { ItemTimerSession, WorkspaceLanguage } from '@utm/core';
import { formatViewDate } from '../../../../utils/dates';
import { FieldIconLabel } from '../../FieldIcon';

const duration = (seconds: number) => {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3_600); const minutes = Math.floor((safe % 3_600) / 60); const remainder = safe % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':');
};

export function TimerHistorySection({ records, language }: { records: readonly ItemTimerSession[]; language?: WorkspaceLanguage }) {
  if (!records.length) return null;
  return <details className="timer-history"><summary><FieldIconLabel path="cycleHistory" label="Timer history" /> <span className="summary-count">{records.length}</span></summary>
    <div className="details-body"><ol className="habit-timer-history">{[...records].reverse().map((record) => <li key={record.id}><span><strong>{record.mode === 'timer' ? 'Timer' : 'Stopwatch'}</strong> · {formatViewDate(record.startedAt, true, language)} — {formatViewDate(record.endedAt, true, language)}</span><strong>{duration(record.durationSeconds)}</strong></li>)}</ol></div>
  </details>;
}
