import { Select } from '../../../../components/ui/primitives';
import { type FriendlyDurationUnit } from '../../../../utils/durations';
import { DurationInput } from './DurationInput';

export function DurationField({ duration, onDurationChange }: {
  duration?: { amount: number; unit: FriendlyDurationUnit };
  onDurationChange: (amount: number | undefined, unit: FriendlyDurationUnit) => void;
}) {
  const unit = duration?.unit ?? 'minutes';
  return <div className="calendar-duration-control">
    <DurationInput presets label="Calendar duration amount" duration={duration} onChange={(next) => onDurationChange(next?.amount, next?.unit ?? unit)} />
    <Select className="duration-unit" aria-label="Calendar duration unit" value={unit} disabled={!duration} onChange={(event) => onDurationChange(duration?.amount, event.target.value as FriendlyDurationUnit)}>
      <option value="seconds">Seconds</option><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option>
    </Select>
  </div>;
}
