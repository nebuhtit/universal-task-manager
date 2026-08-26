import { Input, Select } from '../../../../components/ui/primitives';
import type { FriendlyDurationUnit } from '../../../../utils/durations';

export function DurationField({ enabled, duration, onDurationChange, onPreset }: {
  enabled: boolean;
  duration: { amount: number; unit: FriendlyDurationUnit };
  onDurationChange: (amount: number, unit: FriendlyDurationUnit) => void;
  onPreset: (preset: string) => void;
}) {
  return <div className="calendar-duration-control">
    <Select aria-label="Duration preset" value="" disabled={!enabled} onChange={(event) => onPreset(event.target.value)}>
      <option value="">Presets…</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="1h">1 hour</option><option value="2h">2 hours</option><option value="3h">3 hours</option><option value="5h">5 hours</option><option value="until-sleep">Until sleep</option><option value="all-day">All day</option>
    </Select>
    <Input className="duration-amount" type="number" min="1" aria-label="Calendar duration amount" value={duration.amount} disabled={!enabled} onChange={(event) => onDurationChange(Number(event.target.value) || 1, duration.unit)} />
    <Select className="duration-unit" aria-label="Calendar duration unit" value={duration.unit} disabled={!enabled} onChange={(event) => onDurationChange(duration.amount, event.target.value as FriendlyDurationUnit)}>
      <option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option>
    </Select>
  </div>;
}
