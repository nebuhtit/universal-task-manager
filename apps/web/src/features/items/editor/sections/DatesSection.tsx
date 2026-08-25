import type { ReactNode } from 'react';
import type { Schedule, UniversalItem, WorkspaceDocument } from '@utm/core';
import { SectionGuide } from '../../../../components/ui/SectionGuide';
import type { FriendlyDurationUnit } from '../../../../utils/durations';

type Props = {
  item: UniversalItem;
  workspace: WorkspaceDocument;
  sectionMark: (filled: boolean) => ReactNode;
  dateField: (label: string, value: string | undefined, onChange: (value: string | undefined) => void, help?: string, onFocus?: () => void, minValue?: string) => ReactNode;
  patchSchedule: (patch: { [Key in keyof Schedule]?: Schedule[Key] | undefined }) => void;
  scheduledDuration: { amount: number; unit: FriendlyDurationUnit };
  patchScheduledDuration: (amount: number, unit: FriendlyDurationUnit) => void;
  applyDurationPreset: (preset: string) => void;
  timezoneOpen: boolean;
  setTimezoneOpen: (updater: (current: boolean) => boolean) => void;
};

export function DatesSection({ item, workspace, sectionMark, dateField, patchSchedule, scheduledDuration, patchScheduledDuration, applyDurationPreset, timezoneOpen, setTimezoneOpen }: Props) {
  return <details><summary>Dates &amp; time {sectionMark(Boolean(item.schedule?.availableFrom || item.schedule?.startAt || item.schedule?.endAt || item.schedule?.dueAt || item.schedule?.estimatedDuration || item.schedule?.allDay))}</summary><div className="details-body">
    <p className="schedule-explainer">Scheduled time reserves a calendar block. A deadline is the latest completion time. Availability only says how early work may begin.</p>
    <SectionGuide title="Which date should I use?"><ul><li><strong>Event opens</strong> is when the item becomes active and starts its calendar block.</li><li><strong>Event ends</strong> is only the end of the calendar block.</li><li><strong>Due / Active range ends</strong> is the latest completion time and can close the active range.</li><li><strong>Available to work from</strong> is optional; it keeps reminders quiet before that time.</li></ul></SectionGuide>
    <details className="optional-field"><summary>Available to work from <span>Optional</span></summary><div className="details-body"><label>{dateField('Available to work from', item.schedule?.availableFrom, (value) => patchSchedule({ availableFrom: value }), 'Earliest intended time to begin; not a deadline.')}</label></div></details>
    <div className="form-grid two schedule-grid">
      <label><span>Event opens</span>{dateField('Event opens', item.schedule?.startAt, (value) => patchSchedule({ startAt: value }), 'When it begins and appears in the calendar.')}</label>
      <label><span>Duration</span><div className="duration-control"><select aria-label="Duration preset" value="" disabled={!item.schedule?.startAt} onChange={(event) => applyDurationPreset(event.target.value)}><option value="">Presets…</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="1h">1 hour</option><option value="2h">2 hours</option><option value="3h">3 hours</option><option value="5h">5 hours</option><option value="until-sleep">Until sleep</option><option value="all-day">All day</option></select><input className="duration-amount" type="number" min="1" aria-label="Calendar duration amount" value={scheduledDuration.amount} disabled={!item.schedule?.startAt} onChange={(event) => patchScheduledDuration(Number(event.target.value) || 1, scheduledDuration.unit)} /><select className="duration-unit" aria-label="Calendar duration unit" value={scheduledDuration.unit} disabled={!item.schedule?.startAt} onChange={(event) => patchScheduledDuration(scheduledDuration.amount, event.target.value as FriendlyDurationUnit)}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><small>{item.schedule?.startAt ? 'Choose a preset or type a value. Changes Event ends; Due stays unchanged.' : 'Set Event opens first.'}</small></label>
      <label><span>Event ends</span>{dateField('Event ends', item.schedule?.endAt, (value) => patchSchedule({ endAt: value }), 'When the calendar block ends. Use with Event opens.', undefined, item.schedule?.startAt)}</label>
      <label><span>Due / Active range ends</span>{dateField('Due / Active range ends', item.schedule?.dueAt, (value) => patchSchedule({ dueAt: value }), 'Latest acceptable completion time. Tap the empty field to copy Event opens.', () => { if (!item.schedule?.dueAt && item.schedule?.startAt) patchSchedule({ dueAt: item.schedule.startAt }); }, item.schedule?.startAt)}</label>
    </div>
    <div className="schedule-tools"><button className="timezone-button" aria-expanded={timezoneOpen} onClick={() => setTimezoneOpen((current) => !current)}><span>Timezone</span><strong>{item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</strong><i aria-hidden>{timezoneOpen ? '−' : '⌄'}</i></button></div>
    {timezoneOpen && <div className="timezone-panel"><label>Timezone<input autoFocus list="iana-timezones" value={item.schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone} onChange={(event) => patchSchedule({ timezone: event.target.value })} /></label><small>Used for recurrence and daylight-saving calculations.</small><datalist id="iana-timezones">{typeof Intl.supportedValuesOf === 'function' && Intl.supportedValuesOf('timeZone').map((timezone) => <option value={timezone} key={timezone} />)}</datalist></div>}
  </div></details>;
}
