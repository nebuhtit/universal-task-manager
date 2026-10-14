import { type FriendlyDurationUnit } from '../../../../utils/durations';
import { DurationInput } from './DurationInput';

export function DurationField({ duration, onDurationChange }: {
  duration?: { amount: number; unit: FriendlyDurationUnit };
  onDurationChange: (amount: number | undefined, unit: FriendlyDurationUnit) => void;
}) {
  const unit = duration?.unit ?? 'minutes';
  return <div className="calendar-duration-control">
    <DurationInput presets label="Calendar duration amount" duration={duration} onChange={(next) => onDurationChange(next?.amount, next?.unit ?? unit)} />
  </div>;
}
