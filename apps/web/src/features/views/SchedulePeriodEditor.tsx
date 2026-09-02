import type { CalendarScheduleSource } from '@utm/core';
import { Checkbox, Input, Select } from '../../components/ui/primitives';
import { parseReminderPeriodValue, parseSchedulePeriodValue, type ReminderPeriodValue, type SchedulePeriodValue } from './visualFilterModel';

export const scheduleSourceOptions: Array<{ value: CalendarScheduleSource; periodLabel: string; dayLabel: string }> = [
  { value: 'event_open', periodLabel: 'Event opens in period', dayLabel: 'Event opens in day' },
  { value: 'event', periodLabel: 'Event opens → Event ends overlaps period', dayLabel: 'Event opens → Event ends overlaps day' },
  { value: 'active', periodLabel: 'Event opens → Due overlaps period', dayLabel: 'Event opens → Due overlaps day' },
  { value: 'due', periodLabel: 'Due in period', dayLabel: 'Due in day' },
];

export function ScheduleSourcePicker({ sources, onChange, day = false }: {
  sources: CalendarScheduleSource[];
  onChange: (sources: CalendarScheduleSource[]) => void;
  day?: boolean;
}) {
  const toggle = (source: CalendarScheduleSource, checked: boolean) => {
    const next = checked ? [...new Set([...sources, source])] : sources.filter((candidate) => candidate !== source);
    if (next.length) onChange(next);
  };
  return <div className="schedule-period-sources" aria-label={day ? 'Schedule dates to match in selected day' : 'Schedule dates to match'}>
    {scheduleSourceOptions.map((option) => <Checkbox key={option.value} checked={sources.includes(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} label={day ? option.dayLabel : option.periodLabel} />)}
  </div>;
}

export function SchedulePeriodEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const current = parseSchedulePeriodValue(value);
  const update = (patch: Partial<SchedulePeriodValue>) => onChange(JSON.stringify({ ...current, ...patch }));
  return <div className="schedule-period-editor">
    <PeriodFields value={current} label="Schedule period" onChange={update} />
    <ScheduleSourcePicker sources={current.sources} onChange={(sources) => update({ sources })} />
    <Checkbox checked={current.includeOverdue} onChange={(event) => update({ includeOverdue: event.target.checked })} label="Include overdue" />
    <small className="field-hint">Matches any selected schedule condition. Overdue means an unfinished item whose Due is earlier than now.</small>
  </div>;
}

function PeriodFields({ value, label, onChange }: { value: Pick<SchedulePeriodValue, 'period' | 'nextDays' | 'customStart' | 'customEnd'>; label: string; onChange: (patch: Partial<Pick<SchedulePeriodValue, 'period' | 'nextDays' | 'customStart' | 'customEnd'>>) => void }) {
  return <>
    <Select aria-label={label} value={value.period} onChange={(event) => onChange({ period: event.target.value as SchedulePeriodValue['period'] })}>
      <option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="this_week">This week</option><option value="next_week">Next week</option><option value="next_days">Next N days</option><option value="custom">Custom period</option>
    </Select>
    {value.period === 'next_days' && <Input
      aria-label="Number of days"
      type="number"
      min={1}
      value={value.nextDays}
      onChange={(event) => onChange({ nextDays: Math.max(1, Number(event.target.value) || 1) })}
    />}
    {value.period === 'custom' && <div className="schedule-custom-period"><Input aria-label="Custom period starts" type="date" value={value.customStart} onChange={(event) => onChange({ customStart: event.target.value })} /><Input aria-label="Custom period ends" type="date" value={value.customEnd} onChange={(event) => onChange({ customEnd: event.target.value })} /></div>}
  </>;
}

export function ReminderPeriodEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const current = parseReminderPeriodValue(value);
  const update = (patch: Partial<ReminderPeriodValue>) => onChange(JSON.stringify({ ...current, ...patch }));
  return <div className="schedule-period-editor">
    <Select aria-label="Reminder position relative to period" value={current.relation} onChange={(event) => update({ relation: event.target.value as ReminderPeriodValue['relation'] })}>
      <option value="before">Before period</option><option value="in">Inside period</option><option value="after">After period</option>
    </Select>
    <PeriodFields value={current} label="Reminder comparison period" onChange={update} />
    <small className="field-hint">Uses the nearest active reminder. A reminder without a resolvable date stays active but does not match a period.</small>
  </div>;
}
