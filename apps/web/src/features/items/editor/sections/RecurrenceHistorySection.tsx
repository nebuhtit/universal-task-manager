import { useEffect, useState } from 'react';
import type { RecurrenceCompletionRecord, WorkspaceLanguage } from '@utm/core';
import { Button, Field } from '../../../../components/ui/primitives';
import { formatViewDate } from '../../../../utils/dates';
import { FieldIconLabel } from '../../FieldIcon';
import { DateTimeField } from '../fields/DateTimeField';
import './recurrence-history-section.css';

type SaveResult = { rescheduled: boolean } | void;

function statusLabel(state: RecurrenceCompletionRecord['state']): string {
  if (state === 'done') return 'Completed';
  if (state === 'auto_closed') return 'Auto closed';
  return 'Cancelled';
}

function CompletionHistoryRow({ record, language, onSave }: {
  record: RecurrenceCompletionRecord;
  language: WorkspaceLanguage;
  onSave: (record: RecurrenceCompletionRecord, completedAt: string) => SaveResult;
}) {
  const [draft, setDraft] = useState<string | undefined>(record.completedAt);
  useEffect(() => setDraft(record.completedAt), [record.completedAt]);
  const editable = record.state === 'done';
  const cycleLabel = record.startAt
    ? `Opened ${formatViewDate(record.startAt, true, language)}`
    : `Cycle ${formatViewDate(record.recurrenceId.length === 10 ? `${record.recurrenceId}T00:00:00.000Z` : record.recurrenceId, true, language)}`;

  return <article className="recurrence-completion-row" data-state={record.state}>
    <div className="recurrence-completion-row-heading">
      <strong>{statusLabel(record.state)}</strong>
      {!editable && <span className="recurrence-history-readonly">Read only</span>}
    </div>
    <small>{cycleLabel}{record.dueAt ? ` · Due ${formatViewDate(record.dueAt, true, language)}` : ''}</small>
    {editable ? <Field label="Actually completed at" hint={!record.timeRecorded
      ? 'An older app stored only the completion date. Choose the actual time to complete this history record.'
      : record.affectsNextCycle ? 'This is the latest completion. Changing it also moves the next cycle.' : undefined}>
      <div className="recurrence-completion-editor">
        <DateTimeField label={`Completion time for ${cycleLabel}`} value={draft} language={language} onChange={setDraft} />
        <Button size="compact" disabled={!draft || draft === record.completedAt} onClick={() => {
          if (!draft) return;
          onSave(record, draft);
        }}>Save time</Button>
      </div>
    </Field> : <time dateTime={record.completedAt}>{formatViewDate(record.completedAt, true, language)}</time>}
  </article>;
}

export function RecurrenceHistorySection({ records, language, onSave }: {
  records: RecurrenceCompletionRecord[];
  language: WorkspaceLanguage;
  onSave: (record: RecurrenceCompletionRecord, completedAt: string) => SaveResult;
}) {
  return <details className="recurrence-completion-history">
    <summary><FieldIconLabel path="cycleHistory" label="Completion history" /> <span className="summary-count">{records.length}</span></summary>
    <div className="details-body recurrence-completion-history-body">
      <p className="field-hint">Manual completion times can be corrected here. Automatic closures are kept separately and cannot be edited as if they were completed by you.</p>
      {records.length ? records.map((record) => <CompletionHistoryRow
        key={`${record.ownerItemId}:${record.recurrenceId}:${record.state}`}
        record={record}
        language={language}
        onSave={onSave}
      />) : <p className="empty">No finished cycles yet.</p>}
    </div>
  </details>;
}
