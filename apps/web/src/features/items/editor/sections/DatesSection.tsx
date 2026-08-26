import type { ReactNode } from 'react';
import type { Schedule, UniversalItem, WorkspaceDocument } from '@utm/core';
import { Button, Disclosure, Field, Input, Surface } from '../../../../components/ui/primitives';
import { SectionGuide } from '../../../../components/ui/SectionGuide';
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
  timezoneOpen: boolean;
  setTimezoneOpen: (updater: (current: boolean) => boolean) => void;
  children?: ReactNode;
};

export function DatesSection({ item, workspace, sectionMark, patchSchedule, scheduledDuration, patchScheduledDuration, applyDurationPreset, timezoneOpen, setTimezoneOpen, children }: Props) {
  const language = workspace.calendarPreferences.language;
  return <ItemSection sectionKey="dates" title="Dates & time" iconPath="schedule" filledMark={sectionMark(Boolean(item.schedule?.availableFrom || item.schedule?.startAt || item.schedule?.endAt || item.schedule?.dueAt || item.schedule?.estimatedDuration || item.schedule?.allDay))}>
    <p className="schedule-explainer">Scheduled time reserves a calendar block. A deadline is the latest completion time. Availability only says how early work may begin.</p>
    <SectionGuide title="Which date should I use?"><ul><li><strong>Event opens</strong> is when the item becomes active and starts its calendar block.</li><li><strong>Event ends</strong> is only the end of the calendar block.</li><li><strong>Due / Active range ends</strong> is the latest completion time and can close the active range.</li><li><strong>Available to work from</strong> is optional; it keeps reminders quiet before that time.</li></ul></SectionGuide>
    <Disclosure uiKey="item-editor:available-from" summary={<><FieldIconLabel path="schedule.availableFrom" label="Available to work from" /> <span>Optional</span></>} className="optional-field"><Field label={<FieldIconLabel path="schedule.availableFrom" label="Available to work from" />} optional><DateTimeField label="Available to work from" value={item.schedule?.availableFrom} language={language} onChange={(value) => patchSchedule({ availableFrom: value })} help="Earliest intended time to begin; not a deadline." /></Field></Disclosure>
    <div className="form-grid two schedule-grid">
      <Field label={<FieldIconLabel path="schedule.startAt" label="Event opens" />}><DateTimeField label="Event opens" value={item.schedule?.startAt} language={language} onChange={(value) => patchSchedule({ startAt: value })} help="When it begins and appears in the calendar." /></Field>
      <Field label={<FieldIconLabel path="schedule.estimatedDuration" label="Duration" />} hint={item.schedule?.startAt ? 'Choose a preset or type a value. Changes Event ends; Due stays unchanged.' : 'Set Event opens first.'}><DurationField enabled={Boolean(item.schedule?.startAt)} duration={scheduledDuration} onDurationChange={patchScheduledDuration} onPreset={applyDurationPreset} /></Field>
      <Field label={<FieldIconLabel path="schedule.endAt" label="Event ends" />}><DateTimeField label="Event ends" value={item.schedule?.endAt} language={language} onChange={(value) => patchSchedule({ endAt: value })} help="When the calendar block ends. Use with Event opens." minValue={item.schedule?.startAt} /></Field>
      <Field label={<FieldIconLabel path="schedule.dueAt" label="Due / Active range ends" />}><DateTimeField label="Due / Active range ends" value={item.schedule?.dueAt} language={language} onChange={(value) => patchSchedule({ dueAt: value })} help="Latest acceptable completion time. Tap the empty field to copy Event opens." onFocus={() => { if (!item.schedule?.dueAt && item.schedule?.startAt) patchSchedule({ dueAt: item.schedule.startAt }); }} minValue={item.schedule?.startAt} /></Field>
    </div>
    <div className="schedule-tools"><Button size="compact" variant="ghost" className="timezone-button" aria-expanded={timezoneOpen} onClick={() => setTimezoneOpen((current) => !current)}><span>Timezone</span><strong>{item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</strong><i aria-hidden>{timezoneOpen ? '−' : '⌄'}</i></Button></div>
    {timezoneOpen && <Surface variant="muted" className="timezone-panel"><Field label="Timezone" hint="Used for recurrence and daylight-saving calculations."><Input autoFocus aria-label="Timezone" list="iana-timezones" value={item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(event) => patchSchedule({ timezone: event.target.value })} /></Field><datalist id="iana-timezones">{typeof Intl.supportedValuesOf === 'function' && Intl.supportedValuesOf('timeZone').map((timezone) => <option value={timezone} key={timezone} />)}</datalist></Surface>}
    {children && <div className="date-related-sections">{children}</div>}
  </ItemSection>;
}
