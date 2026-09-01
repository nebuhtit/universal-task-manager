import { createId, type ItemScriptField, type UniversalItem } from '@utm/core';
import { CodeEditor } from '../../../../components/ui/CodeEditor';
import { CloseIcon } from '../../../../components/ui/icons';
import { SectionGuide } from '../../../../components/ui/SectionGuide';
import { formatScriptResult } from '../../fieldDisplay';
import { FieldIconLabel } from '../../FieldIcon';

type Props = {
  item: UniversalItem;
  patchItem: (patch: { [Key in keyof UniversalItem]?: UniversalItem[Key] | undefined }) => void;
  scriptResults: { values: Record<string, unknown>; errors: Record<string, string> };
};

type CountdownPreset = 'custom' | 'adaptive' | 'seconds' | 'minutes' | 'hours';
const countdownPresets: Record<Exclude<CountdownPreset, 'custom'>, Pick<ItemScriptField, 'source' | 'resultKind'>> = {
  adaptive: { source: 'timeUntil(schedule.startAt)', resultKind: 'text' },
  seconds: { source: 'secondsUntil(schedule.startAt)', resultKind: 'number' },
  minutes: { source: 'minutesUntil(schedule.startAt)', resultKind: 'number' },
  hours: { source: 'hoursUntil(schedule.startAt)', resultKind: 'number' },
};
const countdownPresetFor = (script: ItemScriptField): CountdownPreset => (Object.entries(countdownPresets).find(([, preset]) => preset.source === script.source)?.[0] as CountdownPreset | undefined) ?? 'custom';

export function ScriptsSection({ item, patchItem, scriptResults }: Props) {
  const patchScript = (id: string, patch: Partial<ItemScriptField>) => patchItem({ scripts: (item.scripts ?? []).map((script) => script.id === id ? { ...script, ...patch } : script) });
  const addScript = () => patchItem({ scripts: [...(item.scripts ?? []), { id: createId(), key: `calculation_${(item.scripts?.length ?? 0) + 1}`, label: 'New calculation', source: 'timeUntil(schedule.startAt)', resultKind: 'text' }] });
  return <details><summary><FieldIconLabel path="script" label="Scripts" /> {Boolean(item.scripts?.length) && <span className="summary-count">{item.scripts!.length}</span>}</summary><div className="details-body item-scripts">
    <p className="schedule-explainer">Add computed fields to this item. Expressions look like JavaScript, but run in a safe read-only engine: no <code>eval</code>, network, files or workspace changes.</p>
    <SectionGuide title="Variables and examples"><ul><li>Current item: <code>schedule.startAt</code>, <code>schedule.estimatedDuration</code>, <code>priority</code>, <code>custom.rate</code>.</li><li>Compact countdown text: <code>timeUntil(schedule.startAt)</code> → <em>2h 14m</em>.</li><li>Whole-number countdowns for Views: <code>secondsUntil(schedule.startAt)</code>, <code>minutesUntil(schedule.startAt)</code>, <code>hoursUntil(schedule.startAt)</code>, <code>daysUntil(schedule.startAt)</code>. A past time is negative.</li><li>Duration result: choose <strong>Duration</strong>, then use <code>durationUntil(schedule.startAt)</code> or <code>durationBetween(schedule.startAt, schedule.endAt)</code>. Use <code>formatDuration(durationUntil(schedule.startAt))</code> for text.</li><li>Add duration: <code>timeUntil(addDuration(schedule.startAt, schedule.estimatedDuration))</code>.</li><li>Linked item: <code>linked(&quot;related&quot;, &quot;schedule.dueAt&quot;)</code>. Exact item: <code>item(&quot;ITEM_ID&quot;, &quot;priority&quot;)</code>. Another calculation: <code>script.my_key</code>.</li></ul></SectionGuide>
    {(item.scripts ?? []).map((script) => <article className="item-script-row" key={script.id}>
      <div className="item-script-head"><label><FieldIconLabel path={`script.${script.key}`} label="Name" /><input value={script.label} onChange={(event) => { const label = event.target.value; patchScript(script.id, { label, key: script.key.startsWith('calculation_') ? (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || script.key) : script.key }); }} /></label><label><FieldIconLabel path="id" label="Key" /><input className="mono" pattern="[a-z][a-z0-9_]*" value={script.key} onChange={(event) => patchScript(script.id, { key: event.target.value })} /></label><label><FieldIconLabel path={`script.${script.key}`} label="Result" /><select value={script.resultKind} onChange={(event) => patchScript(script.id, { resultKind: event.target.value as ItemScriptField['resultKind'] })}><option value="text">Text</option><option value="number">Number</option><option value="boolean">True / false</option><option value="datetime">Date &amp; time</option><option value="duration">Duration</option></select></label><button className="icon-button" aria-label={`Remove script ${script.label}`} onClick={() => patchItem({ scripts: item.scripts?.filter((entry) => entry.id !== script.id) })}><CloseIcon /></button></div>
      <label><FieldIconLabel path={`script.${script.key}`} label="Countdown format" /><select value={countdownPresetFor(script)} onChange={(event) => { const preset = event.target.value as Exclude<CountdownPreset, 'custom'>; patchScript(script.id, countdownPresets[preset]); }}><option value="custom" disabled>Custom — edit expression below</option><option value="adaptive">Adaptive: days → hours/minutes → seconds</option><option value="seconds">Whole seconds</option><option value="minutes">Whole minutes</option><option value="hours">Whole hours</option></select><small>Presets count down to Event opens. Adaptive switches units automatically; edit the expression below to target another date.</small></label>
      <div className="item-script-expression"><FieldIconLabel path={`script.${script.key}`} label="Expression" /><CodeEditor language="dsl" ariaLabel={`${script.label} expression`} rows={3} value={script.source} onChange={(source) => patchScript(script.id, { source })} /></div>
      <output className={`formula-output${scriptResults.errors[script.key] ? ' error' : ''}`}><small><FieldIconLabel path={`script.${script.key}`} label="Live result" /></small>{scriptResults.errors[script.key] ?? formatScriptResult(scriptResults.values[script.key], script.resultKind)}</output>
    </article>)}
    <button className="secondary" type="button" onClick={addScript}>+ Add computed field</button>
  </div></details>;
}
