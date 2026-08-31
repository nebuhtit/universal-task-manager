import type { ItemSetMetrics, ViewTimeMetrics, WorkspaceLanguage } from '@utm/core';
import './view-metrics-summary.css';

type DurationUnit = 'year' | 'month' | 'day' | 'hour' | 'minute';
type DurationPart = { unit: DurationUnit; value: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_DAYS = 30;
const YEAR_DAYS = 365;

const compactUnits: Record<WorkspaceLanguage, Record<DurationUnit, string>> = {
  en: { year: 'y', month: 'mo', day: 'd', hour: 'h', minute: 'min' },
  ru: { year: 'г', month: 'мес', day: 'д', hour: 'ч', minute: 'мин' },
  es: { year: 'a', month: 'mes', day: 'd', hour: 'h', minute: 'min' },
  de: { year: 'J', month: 'Mon', day: 'T', hour: 'Std', minute: 'Min' },
  fr: { year: 'a', month: 'mois', day: 'j', hour: 'h', minute: 'min' },
  ko: { year: '년', month: '개월', day: '일', hour: '시간', minute: '분' },
};

const locales: Record<WorkspaceLanguage, string> = {
  en: 'en', ru: 'ru', es: 'es', de: 'de', fr: 'fr', ko: 'ko',
};

const summaryPhrases: Record<WorkspaceLanguage, {
  completion: (percent: number) => string;
  remaining: (duration: string) => string;
  free: (duration: string) => string;
  over: (duration: string) => string;
}> = {
  en: { completion: (percent) => `${percent} percent completed`, remaining: (duration) => `${duration} remaining`, free: (duration) => `${duration} free`, over: (duration) => `${duration} over capacity` },
  ru: { completion: (percent) => `Выполнено ${percent} процентов`, remaining: (duration) => `Осталось ${duration}`, free: (duration) => `Свободно ${duration}`, over: (duration) => `Перегрузка ${duration}` },
  es: { completion: (percent) => `${percent} por ciento completado`, remaining: (duration) => `Quedan ${duration}`, free: (duration) => `${duration} libres`, over: (duration) => `${duration} por encima de la capacidad` },
  de: { completion: (percent) => `${percent} Prozent abgeschlossen`, remaining: (duration) => `${duration} verbleibend`, free: (duration) => `${duration} frei`, over: (duration) => `${duration} über Kapazität` },
  fr: { completion: (percent) => `${percent} pour cent terminé`, remaining: (duration) => `Il reste ${duration}`, free: (duration) => `${duration} libres`, over: (duration) => `${duration} au-delà de la capacité` },
  ko: { completion: (percent) => `${percent}퍼센트 완료`, remaining: (duration) => `${duration} 남음`, free: (duration) => `${duration} 여유`, over: (duration) => `${duration} 용량 초과` },
};

const compactCapacityLabels: Record<WorkspaceLanguage, { free: string; over: string }> = {
  en: { free: 'free', over: 'over' }, ru: { free: 'своб.', over: 'перегр.' }, es: { free: 'libre', over: 'exceso' },
  de: { free: 'frei', over: 'über' }, fr: { free: 'libre', over: 'excès' }, ko: { free: '여유', over: '초과' },
};

function durationParts(milliseconds: number): DurationPart[] {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return [];
  const totalMinutes = Math.ceil(milliseconds / MINUTE_MS);
  if (totalMinutes < 60) return [{ unit: 'minute', value: totalMinutes }];
  if (totalMinutes < 24 * 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return [{ unit: 'hour', value: hours }, ...(minutes ? [{ unit: 'minute' as const, value: minutes }] : [])];
  }

  const totalHours = Math.ceil(milliseconds / HOUR_MS);
  if (totalHours < MONTH_DAYS * 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return [{ unit: 'day', value: days }, ...(hours ? [{ unit: 'hour' as const, value: hours }] : [])];
  }

  const totalDays = Math.ceil(milliseconds / DAY_MS);
  if (totalDays < YEAR_DAYS) {
    const months = Math.floor(totalDays / MONTH_DAYS);
    const days = totalDays % MONTH_DAYS;
    return [{ unit: 'month', value: months }, ...(days ? [{ unit: 'day' as const, value: days }] : [])];
  }

  const years = Math.floor(totalDays / YEAR_DAYS);
  const afterYears = totalDays % YEAR_DAYS;
  const months = Math.floor(afterYears / MONTH_DAYS);
  const days = afterYears % MONTH_DAYS;
  return [
    { unit: 'year', value: years },
    ...(months ? [{ unit: 'month' as const, value: months }] : []),
    ...(days ? [{ unit: 'day' as const, value: days }] : []),
  ];
}

export function formatCompactRemainingDuration(milliseconds: number, language: WorkspaceLanguage): string {
  return durationParts(milliseconds).map(({ unit, value }) => `${value}${compactUnits[language][unit]}`).join(' ');
}

function formatAccessibleDuration(milliseconds: number, language: WorkspaceLanguage): string {
  const locale = locales[language];
  return durationParts(milliseconds).map(({ unit, value }) => new Intl.NumberFormat(locale, {
    style: 'unit', unit, unitDisplay: 'long',
  }).format(value)).join(', ');
}

export function formatViewMetricsSummary(metrics: ItemSetMetrics | ViewTimeMetrics, language: WorkspaceLanguage): { text: string; ariaLabel: string } | null {
  const visible: string[] = [];
  const accessible: string[] = [];
  if (metrics.completionPercent > 0) {
    visible.push(`${metrics.completionPercent}%`);
    accessible.push(summaryPhrases[language].completion(metrics.completionPercent));
  }
  if (metrics.remainingDurationMs > 0) {
    visible.push(formatCompactRemainingDuration(metrics.remainingDurationMs, language));
    accessible.push(summaryPhrases[language].remaining(formatAccessibleDuration(metrics.remainingDurationMs, language)));
  }
  if ('freeDurationMs' in metrics && metrics.freeDurationMs !== undefined) {
    const overloaded = metrics.freeDurationMs < 0;
    const absolute = Math.abs(metrics.freeDurationMs);
    const compact = absolute > 0 ? formatCompactRemainingDuration(absolute, language) : `0${compactUnits[language].minute}`;
    const accessibleDuration = absolute > 0 ? formatAccessibleDuration(absolute, language) : new Intl.NumberFormat(locales[language], { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(0);
    visible.push(`${compactCapacityLabels[language][overloaded ? 'over' : 'free']} ${compact}`);
    accessible.push(summaryPhrases[language][overloaded ? 'over' : 'free'](accessibleDuration));
  }
  return visible.length ? { text: visible.join(' · '), ariaLabel: accessible.join('. ') } : null;
}

export function ViewMetricsSummary({ metrics, language, className = '' }: { metrics: ItemSetMetrics | ViewTimeMetrics; language: WorkspaceLanguage; className?: string }) {
  const summary = formatViewMetricsSummary(metrics, language);
  if (!summary) return null;
  return <span className={`view-metrics-summary${className ? ` ${className}` : ''}`} aria-label={summary.ariaLabel}><span aria-hidden="true">{summary.text}</span></span>;
}
