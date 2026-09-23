import { useState, type ReactNode } from 'react';
import { calendarDateKey, type UniversalItem, type WorkspaceDocument } from '@utm/core';
import { Button, Disclosure, Field, IconButton, Input, Select } from '../../../../components/ui/primitives';
import { LineIcon } from '../../../../components/ui/icons';
import type { FriendlyDurationUnit } from '../../../../utils/durations';
import { FieldIconLabel } from '../../FieldIcon';
import { DateTimeField } from '../fields/DateTimeField';
import { DurationField } from '../fields/DurationField';
import { ItemSection } from '../ItemSection';
import { DueQuickChoices } from '../../DueQuickChoices';
import { canQuickChangeDue } from '../../dueQuickActions';
import './dates-section.css';

type Props = {
  item: UniversalItem;
  workspace: WorkspaceDocument;
  now?: Date;
  sectionMark: (filled: boolean) => ReactNode;
  scheduledDuration?: { amount: number; unit: FriendlyDurationUnit };
  travelDuration?: { amount: number; unit: FriendlyDurationUnit };
  travelBackDuration?: { amount: number; unit: FriendlyDurationUnit };
  patchTravelBackDuration?: (amount: number | undefined, unit: FriendlyDurationUnit) => void;
  patchScheduledDuration: (amount: number | undefined, unit: FriendlyDurationUnit) => void;
  patchTravelDuration: (amount: number | undefined, unit: FriendlyDurationUnit) => void;
  patchScheduledStart: (value?: string) => void;
  patchPlannedDate?: (value?: string) => void;
  patchScheduledEnd: (value?: string) => void;
  patchScheduledDue: (value?: string) => void;
  patchQuickDue?: (value: string) => void;
  applyDurationPreset: (preset: string) => void;
  children?: ReactNode;
};

export function DatesSection({ item, workspace, now = new Date(), sectionMark, scheduledDuration, travelDuration, travelBackDuration, patchTravelBackDuration, patchScheduledDuration, patchTravelDuration, patchScheduledStart, patchPlannedDate, patchScheduledEnd, patchScheduledDue, patchQuickDue, applyDurationPreset, children }: Props) {
  const [quickDueOpen, setQuickDueOpen] = useState(false);
  const [dateOnlyMode, setDateOnlyMode] = useState(Boolean(item.schedule?.plannedDate));
  const [pendingDateOnly, setPendingDateOnly] = useState(false);
  const language = workspace.calendarPreferences.language;
  const dateOnly = Boolean(item.schedule?.plannedDate) || (!item.schedule?.startAt && dateOnlyMode);
  const startDateKey = () => {
    const at = item.schedule?.startAt;
    if (!at) return '';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: item.schedule?.timezone ?? workspace.calendarPreferences.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  };
  const opensAt = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
  const invalidEnd = Number.isFinite(opensAt) && Boolean(item.schedule?.endAt) && Date.parse(item.schedule!.endAt!) < opensAt;
  const invalidDue = Number.isFinite(opensAt) && Boolean(item.schedule?.dueAt) && Date.parse(item.schedule!.dueAt!) < opensAt;
  const travelUnit = travelDuration?.unit === 'hours' ? 'hours' : 'minutes';
  const travelLabel = language === 'ru' ? 'Время в пути' : 'Travel time';
  const travelSummary = travelDuration ? `${travelLabel} · ${travelDuration.amount} ${travelUnit === 'hours' ? (language === 'ru' ? 'ч' : 'h') : (language === 'ru' ? 'мин' : 'min')}` : travelLabel;
  return <ItemSection sectionKey="dates" title="Dates & time" iconPath="schedule" filledMark={sectionMark(Boolean(item.schedule?.plannedDate || item.schedule?.availableFrom || item.schedule?.startAt || item.schedule?.endAt || item.schedule?.dueAt || item.schedule?.estimatedDuration || item.schedule?.travelDuration || item.schedule?.allDay))}>
    <Disclosure uiKey="item-editor:date-guide" persist={false} summary="Date guide" className="date-guide"><p className="schedule-explainer">Scheduled time reserves a calendar block. A deadline is the latest completion time. Availability only says how early work may begin.</p><ul><li><strong>Event opens</strong> is when the item becomes active and starts its calendar block.</li><li><strong>Event ends</strong> is only the end of the calendar block.</li><li><strong>Due / Active range ends</strong> is the latest completion time and can close the active range.</li><li><strong>Available to work from</strong> is optional; it keeps reminders quiet before that time.</li></ul></Disclosure>
    <div className="form-grid two schedule-grid">
      {patchTravelBackDuration && (item.schedule?.startAt || item.schedule?.endAt) && !item.schedule?.allDay && <Disclosure uiKey={`item-editor:${item.id}:travel-back`} persist={false} summary={language === 'ru' ? 'Дорога обратно' : 'Travel back'} className="travel-time-disclosure">
        <div className="travel-duration-control"><Input type="number" min="0" step="1" aria-label="Travel back amount" value={travelBackDuration?.amount ?? ''} placeholder="—" onChange={event => patchTravelBackDuration(event.target.value === '' || Number(event.target.value) <= 0 ? undefined : Number(event.target.value), travelBackDuration?.unit ?? 'minutes')} /><Select aria-label="Travel back unit" value={travelBackDuration?.unit ?? 'minutes'} onChange={event => patchTravelBackDuration(travelBackDuration?.amount, event.target.value as FriendlyDurationUnit)}><option value="minutes">Minutes</option><option value="hours">Hours</option></Select></div>
        <small>{language === 'ru' ? 'Сразу после события. Учитывается как занятое время.' : 'Immediately after the event. Counts as busy time.'}</small>
      </Disclosure>}
      <Field label={<FieldIconLabel path="schedule.startAt" label="Event opens" />}>
        {patchPlannedDate && !item.external && <Select aria-label="Event opens precision" value={dateOnly ? 'date' : 'datetime'} onChange={event => {
          if (event.target.value === 'date') {
            if (item.schedule?.startAt) setPendingDateOnly(true);
            else setDateOnlyMode(true);
          } else { setDateOnlyMode(false); setPendingDateOnly(false); if (item.schedule?.plannedDate) patchPlannedDate(undefined); }
        }}><option value="datetime">{language === 'ru' ? 'Дата и время' : 'Date and time'}</option><option value="date">{language === 'ru' ? 'Только дата' : 'Date only'}</option></Select>}
        {dateOnly && patchPlannedDate ? <Input type="date" aria-label="Event opens date" value={item.schedule?.plannedDate ?? ''} onChange={event => patchPlannedDate(event.target.value || undefined)} /> : <DateTimeField label="Event opens" value={item.schedule?.startAt} language={language} onChange={patchScheduledStart} />}
        {pendingDateOnly && <div className="date-only-confirm" role="alert"><p>{language === 'ru' ? 'Время начала, окончания и дорога будут удалены. Оставить только дату?' : 'Start/end times and travel will be removed. Keep only the date?'}</p><Button size="compact" onClick={() => { patchPlannedDate?.(startDateKey()); setDateOnlyMode(true); setPendingDateOnly(false); }}>{language === 'ru' ? 'Оставить дату' : 'Keep date'}</Button><Button size="compact" variant="secondary" onClick={() => setPendingDateOnly(false)}>{language === 'ru' ? 'Отмена' : 'Cancel'}</Button></div>}
      </Field>
      <Field label={<FieldIconLabel path="schedule.estimatedDuration" label="Estimated duration" />}><DurationField hasStart={Boolean(item.schedule?.startAt)} {...(scheduledDuration ? { duration: scheduledDuration } : {})} onDurationChange={patchScheduledDuration} onPreset={applyDurationPreset} /></Field>
      {item.schedule?.startAt && <Field label={<FieldIconLabel path="schedule.endAt" label="Event ends" />} error={invalidEnd ? 'Event ends cannot be earlier than Event opens.' : undefined}><DateTimeField label="Event ends" value={item.schedule?.endAt} language={language} onChange={patchScheduledEnd} minValue={item.schedule.startAt} /></Field>}
      {item.schedule?.startAt && !item.schedule.allDay && <Disclosure uiKey={`item-editor:${item.id}:travel-time`} persist={false} summary={travelSummary} className="travel-time-disclosure">
        <div className="program-actions">{[45, 30, 60, 90, 120].map((minutes) => <Button key={minutes} size="compact" onClick={() => patchTravelDuration(minutes, 'minutes')}>{minutes < 60 ? `${minutes} ${language === 'ru' ? 'мин' : 'min'}` : `${String(minutes / 60).replace('.', language === 'ru' ? ',' : '.')} ${language === 'ru' ? 'ч' : 'h'}`}</Button>)}</div>
        <div className="travel-duration-control"><Input type="number" min="0" step="1" aria-label="Travel time amount" value={travelDuration?.amount ?? ''} placeholder="—" onChange={(event) => patchTravelDuration(event.target.value === '' || Number(event.target.value) <= 0 ? undefined : Number(event.target.value), travelUnit)} /><Select aria-label="Travel time unit" value={travelUnit} onChange={(event) => patchTravelDuration(travelDuration?.amount, event.target.value as FriendlyDurationUnit)}><option value="minutes">Minutes</option><option value="hours">Hours</option></Select></div><small>Reserved immediately before Event opens. It does not change the estimate.</small></Disclosure>}
      <div className="due-field-wrap"><Field label={<FieldIconLabel path="schedule.dueAt" label="Due / Active range ends" />} error={invalidDue ? 'Due / Active range ends cannot be earlier than Event opens.' : undefined}>{item.schedule?.dueDateOnly && item.schedule.dueAt ? <div><Input type="date" aria-label={language === 'ru' ? 'Дата Due без времени' : 'Due date without time'} value={calendarDateKey(new Date(item.schedule.dueAt), item.schedule.timezone)} onChange={event => { if (event.target.value) (patchQuickDue ?? patchScheduledDue)(event.target.value); else patchScheduledDue(undefined); }} /><Button size="compact" variant="ghost" onClick={() => patchScheduledDue(item.schedule?.dueAt)}>{language === 'ru' ? 'Указать время' : 'Set time'}</Button></div> : <DateTimeField label="Due / Active range ends" value={item.schedule?.dueAt} language={language} onChange={patchScheduledDue} help="Latest acceptable completion time. Tap the empty field to copy Event opens." onFocus={() => { if (!item.schedule?.dueAt && item.schedule?.startAt) patchScheduledDue(item.schedule.startAt); }} minValue={item.schedule?.startAt} />}</Field>{canQuickChangeDue(item) && <IconButton size="compact" variant="ghost" className="quick-due-toggle" aria-label={language === 'ru' ? 'Быстро перенести Due' : 'Move Due quickly'} aria-expanded={quickDueOpen} onClick={() => setQuickDueOpen((open) => !open)}><LineIcon name="chevronDown" /></IconButton>}{quickDueOpen && canQuickChangeDue(item) && <div className="quick-due-options"><DueQuickChoices item={item} now={now} language={language} onChoose={(value) => { (patchQuickDue ?? patchScheduledDue)(value); setQuickDueOpen(false); }} /></div>}</div>
    </div>
    {children && <div className="date-related-sections">{children}</div>}
  </ItemSection>;
}
