import { useEffect, useMemo, useState } from 'react';
import { Input, Field, Button, Select, Surface } from '../../components/ui/primitives';
import type { WorkspaceDocument, WorkspaceLanguage } from '@utm/core';
import { interfaceLanguages } from '../../i18n';
import type { CalendarProjectionCache } from './calendarProjectionCache';
import { freeTimeForRange, freeTimeScaleMarks, freeTimeShareText, freeTimeShareTitle } from './freeTimeSharing';

const STORAGE_KEY = 'calendar:free-time-share:v1';
const DAY_MS = 86_400_000;
const scaleLabel = (label: string) => label.endsWith(':00') ? label.slice(0, 2) : label;
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function initialSettings(date: string, defaultLanguage: WorkspaceLanguage) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { start?: string; end?: string; dayStart?: string; dayEnd?: string; buffer?: number; language?: WorkspaceLanguage } | null;
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved.start ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(saved.end ?? '')) {
      return { start: saved.start!, end: saved.end!, dayStart: saved.dayStart ?? '09:00', dayEnd: saved.dayEnd ?? '22:00', buffer: Math.max(0, Math.min(240, Number(saved.buffer) || 0)), language: interfaceLanguages.some(option => option.value === saved.language) ? saved.language! : defaultLanguage };
    }
  } catch { /* Storage is optional. */ }
  return { start: date, end: shiftDate(date, 6), dayStart: '09:00', dayEnd: '22:00', buffer: 30, language: defaultLanguage };
}

function canvasBlob(days: ReturnType<typeof freeTimeForRange>, rangeStart: string, rangeEnd: string, language: WorkspaceLanguage, zone: string, dayStart: string, dayEnd: string): Promise<Blob | null> {
  if (typeof document === 'undefined' || !days.length) return Promise.resolve(null);
  const left = 24, top = 112, rowHeight = 88, trackWidth = 384;
  const width = 432, height = Math.max(520, top + days.length * rowHeight + 24);
  const canvas = document.createElement('canvas');
  canvas.width = width * 2; canvas.height = height * 2;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.scale(2, 2);
  const style = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const background = color('--color-export-background', '#fff');
  const textColor = color('--color-export-text', '#0d0d0d');
  const muted = color('--color-export-secondary', '#676767');
  const border = color('--color-export-grid', '#e5e5e5');
  const reservedColor = color('--color-export-reserved', '#bdbdbd');
  const weekendColor = color('--color-export-weekend', '#b42318');
  context.fillStyle = background; context.fillRect(0, 0, width, height);
  context.fillStyle = textColor; context.font = '600 30px system-ui, sans-serif';
  context.fillText(freeTimeShareTitle(language), left, 42);
  context.fillStyle = muted; context.font = '16px system-ui, sans-serif';
  context.fillText(`${rangeStart} – ${rangeEnd} · ${dayStart}–${dayEnd}`, left, 70);
  const formatter = new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  context.font = '14px system-ui, sans-serif';
  days.forEach((day, index) => {
    const y = top + index * rowHeight;
    context.textAlign = 'left'; context.fillStyle = isWeekend(day.date) ? weekendColor : textColor; context.font = '600 16px system-ui, sans-serif';
    context.fillText(formatter.format(new Date(`${day.date}T12:00:00Z`)), left, y);
    if (day.end <= day.start) return;
    const marks = freeTimeScaleMarks(day, zone);
    context.font = '10px system-ui, sans-serif';
    let previousLabelEnd = -Infinity;
    marks.forEach((mark, markIndex) => {
      const x = left + (mark.at - day.start) / (day.end - day.start) * trackWidth;
      const label = scaleLabel(mark.label), labelWidth = context.measureText(label).width;
      const labelStart = markIndex === 0 ? x : markIndex === marks.length - 1 ? x - labelWidth : x - labelWidth / 2;
      const lastMark = marks.at(-1)!;
      const finalLabelStart = left + trackWidth - context.measureText(scaleLabel(lastMark.label)).width;
      if (markIndex === marks.length - 1 || (labelStart >= previousLabelEnd + 3 && (markIndex === 0 || labelStart + labelWidth + 3 < finalLabelStart))) {
        context.fillStyle = muted; context.textAlign = 'left';
        context.fillText(label, labelStart, y + 20);
        previousLabelEnd = labelStart + labelWidth;
      }
      context.strokeStyle = border; context.lineWidth = 0.5;
      context.beginPath(); context.moveTo(x, y + 25); context.lineTo(x, y + 48); context.stroke();
    });
    context.font = '14px system-ui, sans-serif';
    const roundedInterval = (interval: { start: number; end: number }, fill: string) => {
      const startRatio = (interval.start - day.start) / (day.end - day.start);
      const endRatio = (interval.end - day.start) / (day.end - day.start);
      context.fillStyle = fill;
      context.beginPath();
      context.roundRect(left + startRatio * trackWidth, y + 30, (endRatio - startRatio) * trackWidth, 14, 7);
      context.fill();
    };
    for (const interval of day.reserved) roundedInterval(interval, reservedColor);
    for (const interval of day.booked) roundedInterval(interval, textColor);
  });
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

async function pdfBlob(days: ReturnType<typeof freeTimeForRange>, language: WorkspaceLanguage, zone: string, dayStart: string, dayEnd: string): Promise<Blob | null> {
  if (!days.length) return null;
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (let offset = 0; offset < days.length; offset += 7) {
    const pageDays = days.slice(offset, offset + 7);
    const image = await canvasBlob(pageDays, pageDays[0]!.date, pageDays.at(-1)!.date, language, zone, dayStart, dayEnd);
    if (!image) return null;
    const png = await pdf.embedPng(await image.arrayBuffer());
    const page = pdf.addPage([png.width / 2, png.height / 2]);
    page.drawImage(png, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return new Blob([new Uint8Array(await pdf.save()).buffer], { type: 'application/pdf' });
}

export function CalendarAvailabilityShare({ workspace, initialDate, now, projectionCache }: {
  workspace: WorkspaceDocument;
  initialDate: string;
  now: Date;
  projectionCache?: CalendarProjectionCache;
}) {
  const [settings, setSettings] = useState(() => initialSettings(initialDate, workspace.calendarPreferences.language));
  const [requested, setRequested] = useState(false);
  const [exportPdf, setExportPdf] = useState<Blob | null>(null);
  const [status, setStatus] = useState('');
  const interfaceLanguage = workspace.calendarPreferences.language;
  const language = settings.language;
  const timeZone = workspace.calendarPreferences.timezone;
  const dayCount = Math.floor((Date.parse(`${settings.end}T12:00:00Z`) - Date.parse(`${settings.start}T12:00:00Z`)) / DAY_MS) + 1;
  const validDayHours = /^\d{2}:\d{2}$/.test(settings.dayStart) && /^\d{2}:\d{2}$/.test(settings.dayEnd) && settings.dayStart < settings.dayEnd;
  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(settings.start) && /^\d{4}-\d{2}-\d{2}$/.test(settings.end) && settings.start <= settings.end && dayCount >= 1 && dayCount <= 31 && validDayHours;
  const days = useMemo(() => requested && validRange ? freeTimeForRange(workspace, settings.start, settings.end, settings.buffer, now, projectionCache, settings.dayStart, settings.dayEnd) : [], [requested, validRange, workspace, settings.start, settings.end, settings.dayStart, settings.dayEnd, settings.buffer, now.getTime(), projectionCache]);
  const shareText = useMemo(() => freeTimeShareText(days, language, timeZone), [days, language, timeZone]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Storage is optional. */ }
  }, [settings]);
  useEffect(() => {
    setExportPdf(null);
    if (!requested) return;
    let cancelled = false;
    void pdfBlob(days, language, timeZone, settings.dayStart, settings.dayEnd).then(blob => { if (!cancelled) setExportPdf(blob); }).catch(() => {
      if (!cancelled) setStatus(interfaceLanguage === 'ru' ? 'Не удалось создать PDF. Попробуйте ещё раз.' : 'Could not create PDF. Please try again.');
    });
    return () => { cancelled = true; };
  }, [requested, days, language, timeZone, settings.dayStart, settings.dayEnd, interfaceLanguage]);

  const update = (changes: Partial<typeof settings>) => { setStatus(''); setSettings(current => ({ ...current, ...changes })); setRequested(true); };
  const share = () => {
    const file = exportPdf ? new File([exportPdf], 'universal-free-time.pdf', { type: 'application/pdf' }) : null;
    const shareNavigator = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (file && navigator.share && shareNavigator.canShare?.({ files: [file] })) {
      void navigator.share({ files: [file] }).then(() => setStatus(interfaceLanguage === 'ru' ? 'Поделились.' : 'Shared.')).catch(reason => { if (reason?.name !== 'AbortError') setStatus(interfaceLanguage === 'ru' ? 'Не удалось открыть меню «Поделиться».' : 'Could not open the share sheet.'); });
      return;
    }
    if (file) {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(interfaceLanguage === 'ru' ? 'PDF сохранён в загрузки.' : 'PDF saved to Downloads.');
    }
  };

  const dateLabel = (date: string) => new Intl.DateTimeFormat(language, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`));
  const timeLabel = (value: number) => new Intl.DateTimeFormat(language, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return <section className="calendar-availability-share" aria-label={interfaceLanguage === 'ru' ? 'Поделиться свободным временем' : 'Share available time'}>
    <div className="calendar-availability-controls">
      <Field label={interfaceLanguage === 'ru' ? 'С' : 'From'}><Input type="date" value={settings.start} onChange={event => update({ start: event.target.value })} /></Field>
      <Field label={interfaceLanguage === 'ru' ? 'По' : 'To'}><Input type="date" value={settings.end} onChange={event => update({ end: event.target.value })} /></Field>
      <Field label={interfaceLanguage === 'ru' ? 'Начало дня' : 'Day starts'}><Input type="time" value={settings.dayStart} onChange={event => update({ dayStart: event.target.value })} /></Field>
      <Field label={interfaceLanguage === 'ru' ? 'Конец дня' : 'Day ends'}><Input type="time" value={settings.dayEnd} onChange={event => update({ dayEnd: event.target.value })} /></Field>
      <Field label={interfaceLanguage === 'ru' ? 'Буфер до и после занятых отрезков, мин' : 'Buffer before and after busy intervals, min'}><Input type="number" min={0} max={240} step={5} value={settings.buffer} onChange={event => update({ buffer: Math.max(0, Math.min(240, Number(event.target.value) || 0)) })} /></Field>
      <Field label={interfaceLanguage === 'ru' ? 'Язык экспорта' : 'Export language'}><Select value={language} onChange={event => { setStatus(''); setSettings(current => ({ ...current, language: event.target.value as WorkspaceLanguage })); }}>{interfaceLanguages.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></Field>
    </div>
    <p className="field-hint">{interfaceLanguage === 'ru' ? 'Учитываются события, запланированные задачи, Travel time и повторения, кроме Sleep, выбранного в настройках Timeline. Названия событий не попадут в текст или PDF. Максимум — 31 день.' : 'Includes scheduled events, planned tasks, Travel time, and recurrence, except the Sleep item selected in Timeline settings. Event names are not included in the text or PDF. Maximum: 31 days.'}</p>
    {!validRange && <p className="error" role="alert">{settings.start > settings.end ? (interfaceLanguage === 'ru' ? 'Начало диапазона должно быть раньше конца.' : 'The range start must be before its end.') : (interfaceLanguage === 'ru' ? 'Выберите диапазон не длиннее 31 дня.' : 'Choose a range of 31 days or less.')}</p>}
    {validRange && !requested && <Button onClick={() => setRequested(true)}>{interfaceLanguage === 'ru' ? 'Показать свободное время' : 'Show available time'}</Button>}
    {validRange && requested && <>
      <div className="calendar-availability-chart" role="img" aria-label={interfaceLanguage === 'ru' ? 'Свободное время — белое, события — чёрные, закреплённые блоки — серые; названия скрыты' : 'Free time is white, events are black, reserved blocks are gray; titles are hidden'}>
        {days.map(day => { const marks = freeTimeScaleMarks(day, timeZone); const position = (value: number) => 100 * (value - day.start) / (day.end - day.start); return <div className="calendar-availability-row" key={day.date}>
          <span className="calendar-availability-date" data-weekend={isWeekend(day.date)}>{dateLabel(day.date)}</span>
          <div className="calendar-availability-track">{marks.length > 0 && <>
            {marks.map(mark => <span key={mark.at} className="calendar-availability-hour-mark" data-edge={mark.at === day.start ? 'start' : mark.at === day.end ? 'end' : undefined} style={{ left: `${position(mark.at)}%` }} title={mark.label}>{scaleLabel(mark.label)}</span>)}
            {marks.map(mark => <span key={`grid-${mark.at}`} className="calendar-availability-gridline" style={{ left: `${position(mark.at)}%` }} />)}
            {day.reserved.map((interval, index) => <span key={`reserved-${index}`} className="calendar-availability-busy calendar-availability-reserved" style={{ left: `${position(interval.start)}%`, width: `${100 * (interval.end - interval.start) / (day.end - day.start)}%` }} title={`${timeLabel(interval.start)}–${timeLabel(interval.end)}`} />)}
            {day.booked.map((interval, index) => <span key={`booked-${index}`} className="calendar-availability-busy" style={{ left: `${position(interval.start)}%`, width: `${100 * (interval.end - interval.start) / (day.end - day.start)}%` }} title={`${timeLabel(interval.start)}–${timeLabel(interval.end)}`} />)}
          </>}</div>
        </div>; })}
      </div>
      <Surface variant="muted" className="calendar-availability-text"><pre>{shareText}</pre></Surface>
      <Button variant="primary" disabled={!exportPdf} onClick={share}>{interfaceLanguage === 'ru' ? 'Поделиться PDF' : 'Share PDF'}</Button>
      {status && <p role="status">{status}</p>}
    </>}
  </section>;
}
