import { Input, Select } from '../../../../components/ui/primitives';
import type { FriendlyDurationUnit } from '../../../../utils/durations';

export function DurationField({ hasStart, duration, onDurationChange, onPreset }: {
  hasStart: boolean;
  duration?: { amount: number; unit: FriendlyDurationUnit };
  onDurationChange: (amount: number | undefined, unit: FriendlyDurationUnit) => void;
  onPreset: (preset: string) => void;
}) {
  const unit = duration?.unit ?? 'minutes';
  return <div className="calendar-duration-control">
    <Select aria-label="Duration preset" value="" onChange={(event) => onPreset(event.target.value)}>
      <option value="">Presets…</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="1h">1 hour</option><option value="2h">2 hours</option><option value="3h">3 hours</option><option value="5h">5 hours</option><option value="until-sleep" disabled={!hasStart}>Until sleep</option><option value="all-day" disabled={!hasStart}>All day</option>
    </Select>
    <Input className="duration-amount" type="number" min="1" aria-label="Calendar duration amount" value={duration?.amount ?? ''} placeholder="—" onChange={(event) => onDurationChange(event.target.value === '' ? undefined : Math.max(1, Number(event.target.value) || 1), unit)} />
    <Select className="duration-unit" aria-label="Calendar duration unit" value={unit} disabled={!duration} onChange={(event) => onDurationChange(duration?.amount, event.target.value as FriendlyDurationUnit)}>
      <option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option>
    </Select>
  </div>;
}
