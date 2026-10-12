import type { ReactNode } from 'react';
import { PositiveNumberInput } from '../../../../components/ui/PositiveNumberInput';
import { DurationInput } from '../fields/DurationInput';
import { createId, type UniversalItem } from '@utm/core';
import { CloseIcon } from '../../../../components/ui/icons';
import { Button, IconButton, Input, Select } from '../../../../components/ui/primitives';
import { SectionGuide } from '../../../../components/ui/SectionGuide';
import { FieldIconLabel } from '../../FieldIcon';
import { dateInput, fromDateInput } from '../../../../utils/dates';
import { parseReminderDuration, reminderIsoDuration, type ReminderDurationUnit } from '../../../../utils/durations';
import './reminders-section.css';
import { isNativeReminderAvailable } from '../../../../services/nativeReminders';

type Props = { language?: string; item: UniversalItem; now: Date; sectionMark: (filled: boolean) => ReactNode; patchItem: (patch: { [Key in keyof UniversalItem]?: UniversalItem[Key] | undefined }) => void };

export function RemindersSection({ language, item, now, sectionMark, patchItem }: Props) {
  const ru = language === 'ru';
  return <details><summary><FieldIconLabel path="reminders" label="Reminders" /> {sectionMark(item.reminders.length > 0)}</summary><div className="details-body">
    <p className="schedule-explainer">{ru ? 'Укажите, за сколько напомнить до начала события. 0 — в момент начала. Можно также выбрать отдельную дату и время.' : 'Choose how long before Event opens to remind you. Use 0 for the start itself, or choose a separate date and time.'}</p>
    {item.reminders.some(reminder => reminder.delivery === 'alarm') && !isNativeReminderAvailable() && <p role="status">{ru ? 'Системный будильник не установлен: откройте workspace в приложении iOS.' : 'System alarm not installed: open this workspace in the iOS app.'}</p>}
    <p className="schedule-explainer">{ru ? 'Будильник требует iOS 26 и разрешения AlarmKit; звучит даже в беззвучном режиме. Без разрешения системный будильник не установлен.' : 'Alarm requires iOS 26 and AlarmKit permission; sounds even in silent mode. Without permission the system alarm is not installed.'}</p><SectionGuide title="How reminders behave"><p>Use more than one reminder when needed. Due reminders for the same item are shown as one card with a count. Closing the pop-up only hides it; deleting it from Notifications confirms those reminders so they do not return after the next unlock.</p></SectionGuide>
    {item.reminders.map((reminder, index) => {
      const relative = reminder.mode === 'relative';
      const parsed = parseReminderDuration(reminder.offset);
      const calendarUnit = parsed.unit === 'months' || parsed.unit === 'years';
      const clearSnooze = <T extends typeof reminder>(entry: T): T => { const next = { ...entry }; delete next.snoozedUntil; return next; };
      const update = (patch: Partial<typeof reminder>) => patchItem({ reminders: item.reminders.map(entry => entry.id === reminder.id ? clearSnooze({ ...entry, ...patch }) : entry) });
      const updateOffset = (amount: number, unit: ReminderDurationUnit) => update({ offset: `${parsed.before ? '-' : ''}${reminderIsoDuration(amount, unit)}` });
      return <div className="reminder-row" key={reminder.id}>
        <Select aria-label={`Reminder ${index + 1} delivery`} value={reminder.delivery ?? 'notification'} onChange={event => update({ delivery: event.target.value as 'notification' | 'alarm' })}>
          <option value="notification">{ru ? 'Уведомление' : 'Notification'}</option><option value="alarm">{ru ? 'Будильник' : 'Alarm'}</option>
        </Select>
        <Select aria-label={`Reminder ${index + 1} mode`} value={relative ? (parsed.before ? 'before' : 'after') : 'absolute'} onChange={event => {
          const mode = event.target.value;
          update(mode === 'absolute'
            ? { mode: 'absolute', at: reminder.at ?? item.schedule?.startAt ?? now.toISOString() }
            : { mode: 'relative', relativeTo: 'start', offset: `${mode === 'before' ? '-' : ''}${reminderIsoDuration(parsed.amount, parsed.unit)}` });
        }}>
          <option value="before">{ru ? 'До начала события' : 'Before Event opens'}</option>
          <option value="after">{ru ? 'После начала события' : 'After Event opens'}</option>
          <option value="absolute">{ru ? 'Отдельная дата и время' : 'Separate date and time'}</option>
        </Select>
        <IconButton className="reminder-remove" size="compact" variant="ghost" aria-label={ru ? 'Удалить напоминание' : 'Remove reminder'} onClick={() => patchItem({ reminders: item.reminders.filter(entry => entry.id !== reminder.id) })}><CloseIcon /></IconButton>
        <div className="reminder-value">
          {relative ? calendarUnit ? <>
            <PositiveNumberInput aria-label={`Reminder ${index + 1} amount`} value={parsed.amount} onValueChange={amount => updateOffset(amount, parsed.unit)} />
            <Select aria-label={`Reminder ${index + 1} unit`} value={parsed.unit} onChange={event => updateOffset(parsed.amount, event.target.value as ReminderDurationUnit)}>
              {['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'].map(unit => <option key={unit}>{unit}</option>)}
            </Select>
          </> : <DurationInput label={`Reminder ${index + 1} amount`} allowZero showUnit presets duration={{ amount: parsed.amount, unit: parsed.unit as Exclude<ReminderDurationUnit, 'months' | 'years'> }} onChange={value => { if (value) updateOffset(value.amount, value.unit); }} />
            : <Input aria-label={`Reminder ${index + 1} time`} type="datetime-local" value={dateInput(reminder.at)} onChange={event => {
              const at = fromDateInput(event.target.value);
              patchItem({ reminders: item.reminders.map(entry => {
                if (entry.id !== reminder.id) return entry;
                const next = clearSnooze(entry);
                if (at) next.at = at; else delete next.at;
                return next;
              }) });
            }} />}
        </div>
        {reminder.snoozedUntil && <div className="reminder-snoozed"><small>Next alert: {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reminder.snoozedUntil))} · original schedule shown above</small><Button size="compact" variant="ghost" onClick={() => update({})}>Cancel snooze</Button></div>}
      </div>;
    })}
    <Button variant="secondary" onClick={() => patchItem({ reminders: [...item.reminders, { id: createId(), mode: 'relative', relativeTo: 'start', offset: '-PT10M', repeatUntilAcknowledged: false }] })}>{ru ? '+ Добавить напоминание' : '+ Add reminder'}</Button>
  </div></details>;
}
