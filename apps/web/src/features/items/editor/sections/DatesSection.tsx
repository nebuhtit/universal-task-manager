import type { ReactNode } from 'react';
import type { Schedule, UniversalItem, WorkspaceDocument } from '@utm/core';
import { Disclosure, Field } from '../../../../components/ui/primitives';
import type { FriendlyDurationUnit } from '../../../../utils/durations';
import { FieldIconLabel } from '../../FieldIcon';
import { DateTimeField } from '../fields/DateTimeField';
import { DurationField } from '../fields/DurationField';
import { ItemSection } from '../ItemSection';
import './dates-section.css';

type Props = {
  item: UniversalItem;
  workspace: WorkspaceDocument;
  sectionMark: (filled: boolean) => ReactNode;
  patchSchedule: (patch: { [Key in keyof Schedule]?: Schedule[Key] | undefined }) => void;
  scheduledDuration: { amount: number; unit: FriendlyDurationUnit };
  patchScheduledDuration: (amount: number, unit: FriendlyDurationUnit) => void;
  applyDurationPreset: (preset: string) => void;
  children?: ReactNode;
};

export function DatesSection({ item, workspace, sectionMark, patchSchedule, scheduledDuration, patchScheduledDuration, applyDurationPreset, children }: Props) {
  const language = workspace.calendarPreferences.language;
  const opensAt = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
  const invalidEnd = Number.isFinite(opensAt) && Boolean(item.schedule?.endAt) && Date.parse(item.schedule!.endAt!) < opensAt;
  const invalidDue = Number.isFinite(opensAt) && Boolean(item.schedule?.dueAt) && Date.parse(item.schedule!.dueAt!) < opensAt;
  return <ItemSection sectionKey="dates" title="Dates & time" iconPath="schedule" filledMark={sectionMark(Boolean(item.schedule?.availableFrom || item.schedule?.startAt || item.schedule?.endAt || item.schedule?.dueAt || item.schedule?.estimatedDuration || item.schedule?.allDay))}>
    <Disclosure uiKey="item-editor:date-guide" persist={false} summary="Date guide" className="date-guide"><p className="schedule-explainer">Scheduled time reserves a calendar block. A deadline is the latest completion time. Availability only says how early work may begin.</p><ul><li><strong>Event opens</strong> is when the item becomes active and starts its calendar block.</li><li><strong>Event ends</strong> is only the end of the calendar block.</li><li><strong>Due / Active range ends</strong> is the latest completion time and can close the active range.</li><li><strong>Available to work from</strong> is optional; it keeps reminders quiet before that time.</li></ul></Disclosure>
    <div className="form-grid two schedule-grid">
      <Field label={<FieldIconLabel path="schedule.startAt" label="Event opens" />}><DateTimeField label="Event opens" value={item.schedule?.startAt} language={language} onChange={(value) => patchSchedule(value ? { startAt: value } : { startAt: undefined, endAt: undefined })} /></Field>
      <Field label={<FieldIconLabel path="schedule.estimatedDuration" label="Duration" />} hint={item.schedule?.startAt ? 'Choose a preset or type a value. Changes Event ends; Due stays unchanged.' : 'Set Event opens first.'}><DurationField enabled={Boolean(item.schedule?.startAt)} duration={scheduledDuration} onDurationChange={patchScheduledDuration} onPreset={applyDurationPreset} /></Field>
      {item.schedule?.startAt && <Field label={<FieldIconLabel path="schedule.endAt" label="Event ends" />} error={invalidEnd ? 'Event ends cannot be earlier than Event opens.' : undefined}><DateTimeField label="Event ends" value={item.schedule?.endAt} language={language} onChange={(value) => patchSchedule({ endAt: value })} minValue={item.schedule.startAt} /></Field>}
      <Field label={<FieldIconLabel path="schedule.dueAt" label="Due / Active range ends" />} error={invalidDue ? 'Due / Active range ends cannot be earlier than Event opens.' : undefined}><DateTimeField label="Due / Active range ends" value={item.schedule?.dueAt} language={language} onChange={(value) => patchSchedule({ dueAt: value })} help="Latest acceptable completion time. Tap the empty field to copy Event opens." onFocus={() => { if (!item.schedule?.dueAt && item.schedule?.startAt) patchSchedule({ dueAt: item.schedule.startAt }); }} minValue={item.schedule?.startAt} /></Field>
    </div>
    {children && <div className="date-related-sections">{children}</div>}
  </ItemSection>;
}
