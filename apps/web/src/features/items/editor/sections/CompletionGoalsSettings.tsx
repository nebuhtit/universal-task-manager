import { countGoalResult, type Progress, type UniversalItem } from '@utm/core';
import { Field, Input, Select } from '../../../../components/ui/primitives';

export function CompletionGoalsSettings({ item, language, onChange }: { item: UniversalItem; language: string; onChange: (progress: Progress) => void }) {
  const t = (english: string, russian: string) => language === 'ru' ? russian : english;
  const progress = item.progress;
  const base: Progress = progress ?? { mode: 'counter', current: 0, target: 1 };
  const update = (changes: Partial<Progress>) => onChange({ ...base, ...changes });
  const setComparison = (comparison: NonNullable<Progress['durationGoal']>['comparison'] | '') => {
    const { durationGoal: _old, ...rest } = base;
    onChange(comparison ? { ...rest, durationGoal: { comparison, minSeconds: progress?.durationGoal?.minSeconds ?? 0, maxSeconds: progress?.durationGoal?.maxSeconds ?? 0 } } : rest);
  };
  const updateDuration = (field: 'minSeconds' | 'maxSeconds', minutes: number) => {
    if (!progress?.durationGoal) return;
    update({ durationGoal: { ...progress.durationGoal, [field]: Math.max(0, Math.round(minutes * 60)) } });
  };
  const count = countGoalResult(item);
  return <>
    <div className="form-grid three">
      <Field label={t('Mode', 'Режим')}><Select value={base.mode} onChange={(event) => update({ mode: event.target.value as Progress['mode'] })}><option value="boolean">{t('Done / not done', 'Выполнено / нет')}</option><option value="percent">{t('Percentage', 'Процент')}</option><option value="counter">{t('Completion count', 'Число выполнений')}</option></Select></Field>
      {base.mode !== 'counter' && <Field label={t('Current', 'Текущее значение')}><Input type="number" value={base.current} onChange={(event) => update({ current: Number(event.target.value) })} /></Field>}
      <Field label={base.mode === 'counter' ? t('Completion goal', 'Цель по числу выполнений') : t('Target', 'Цель')}><Input type="number" min={base.mode === 'counter' ? 1 : undefined} value={progress?.target ?? ''} onChange={(event) => update({ target: Number(event.target.value) })} /></Field>
    </div>
    {base.mode === 'counter' && <>
      <Field label={t('Count goal', 'Условие для числа выполнений')}><Select value={base.countComparison ?? 'at_least'} onChange={(event) => update({ countComparison: event.target.value as NonNullable<Progress['countComparison']> })}><option value="at_least">{t('At least', 'Не меньше')}</option><option value="at_most">{t('At most', 'Не больше')}</option></Select></Field>
      <p role="status">{count?.count ?? 0} · {count?.met ? t('Goal done', 'Цель достигнута') : t('Goal not reached', 'Цель не достигнута')}{count && count.difference > 0 ? ` · +${count.difference}` : ''}</p>
    </>}
    <details><summary>{t('Duration goal for each completion', 'Цель по длительности каждого выполнения')}</summary><div className="details-body">
      <Field label={t('Compare duration', 'Условие по времени')}><Select value={progress?.durationGoal?.comparison ?? ''} onChange={(event) => setComparison(event.target.value as NonNullable<Progress['durationGoal']>['comparison'] | '')}><option value="">{t('No duration goal', 'Без цели по времени')}</option><option value="at_least">{t('At least', 'Не меньше')}</option><option value="at_most">{t('At most', 'Не больше')}</option><option value="between">{t('Between', 'В пределах')}</option></Select></Field>
      {progress?.durationGoal && <div className="form-grid two">
        {progress.durationGoal.comparison !== 'at_most' && <Field label={t('Minimum minutes', 'Минимум, мин')}><Input type="number" min={0} step="any" value={(progress.durationGoal.minSeconds ?? 0) / 60} onChange={(event) => updateDuration('minSeconds', Number(event.target.value))} /></Field>}
        {progress.durationGoal.comparison !== 'at_least' && <Field label={t('Maximum minutes', 'Максимум, мин')}><Input type="number" min={0} step="any" value={(progress.durationGoal.maxSeconds ?? 0) / 60} onChange={(event) => updateDuration('maxSeconds', Number(event.target.value))} /></Field>}
      </div>}
      {progress?.durationGoal?.comparison === 'between' && (progress.durationGoal.minSeconds ?? 0) > (progress.durationGoal.maxSeconds ?? 0) && <p role="alert">{t('Maximum must be at least the minimum.', 'Максимум должен быть не меньше минимума.')}</p>}
    </div></details>
  </>;
}
