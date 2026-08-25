import type { WorkspaceDocument, WorkspaceLanguage } from '@utm/core';

export const dateInput = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export const fromDateInput = (value: string) => (value ? new Date(value).toISOString() : undefined) as string;

export const localeForLanguage = (language?: WorkspaceLanguage): string => ({ en: 'en-GB', ru: 'ru-RU', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', ko: 'ko-KR' }[language ?? (document.documentElement.lang as WorkspaceLanguage)] ?? 'en-GB');

export const formatSystemDateTime = (value: string | number | Date, language?: WorkspaceLanguage): string => new Intl.DateTimeFormat(localeForLanguage(language), {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));

export const formatRussianDateTime = formatSystemDateTime;

export const formatViewDate = (value: string | number | Date, includeTime = true, language?: WorkspaceLanguage): string => {
  const formatter = new Intl.DateTimeFormat(localeForLanguage(language), {
    weekday: 'short', day: 'numeric', month: 'short', year: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  });
  const values = Object.fromEntries(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value.replace(/\./g, '')]));
  const date = [values.weekday, values.day, values.month, values.year].filter(Boolean).join(' ');
  return includeTime ? `${date}, ${values.hour}:${values.minute}` : date;
};

export const formatHeaderDate = (value: Date, language: WorkspaceLanguage): string => {
  const formatter = new Intl.DateTimeFormat(localeForLanguage(language), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const values = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value.replace(/\./g, '')]));
  return `${values.weekday} ${values.day} ${values.month} ${values.year} · ${values.hour}:${values.minute}:${values.second}`;
};

export const clockMinutes = (value: string) => { const [hours = 0, minutes = 0] = value.split(':').map(Number); return hours * 60 + minutes; };

export const scheduledTheme = (lightAt: string, darkAt: string, now = new Date()) => {
  const minute = now.getHours() * 60 + now.getMinutes(); const light = clockMinutes(lightAt); const dark = clockMinutes(darkAt);
  if (light === dark) return 'light';
  return light < dark ? (minute >= light && minute < dark ? 'light' : 'dark') : (minute >= light || minute < dark ? 'light' : 'dark');
};

export const isSleepTime = (date: Date, schedule: WorkspaceDocument['calendarPreferences']['sleepSchedule']) => {
  const minute = date.getHours() * 60 + date.getMinutes(); const wake = clockMinutes(schedule.wake); const sleep = clockMinutes(schedule.sleep);
  if (wake === sleep) return false;
  return sleep < wake ? minute >= sleep && minute < wake : minute >= sleep || minute < wake;
};
