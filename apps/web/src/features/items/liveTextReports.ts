import { APP_VERSION } from '@utm/core';
import type { Draft } from '../../../quick-entry-lab/parser';

export interface LiveTextReport {
  id: string;
  createdAt: string;
  appVersion: string;
  referenceTime: string;
  timezone: string;
  input: string;
  parsed: Draft;
  expected: string;
}
const key = (workspaceId: string) => `utm:live-text-reports:${workspaceId}`;
export function readLiveTextReports(workspaceId: string): LiveTextReport[] {
  const raw = localStorage.getItem(key(workspaceId));
  if (!raw) return [];
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records)) throw new Error('Не удалось прочитать журнал Live text.');
  return records as LiveTextReport[];
}
export function saveLiveTextReport(workspaceId: string, report: Pick<LiveTextReport, 'input' | 'parsed' | 'expected' | 'referenceTime'>): void {
  const record: LiveTextReport = { ...report, id: crypto.randomUUID(), createdAt: new Date().toISOString(), appVersion: APP_VERSION, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const serialized = JSON.stringify([...readLiveTextReports(workspaceId), record].slice(-100));
  localStorage.setItem(key(workspaceId), serialized);
  if (localStorage.getItem(key(workspaceId)) !== serialized) throw new Error('Не удалось сохранить отчёт.');
}
export function clearLiveTextReports(workspaceId: string): void { localStorage.removeItem(key(workspaceId)); }
export function exportLiveTextReports(workspaceId: string): void {
  const content = JSON.stringify({ format: 'utm-live-text-reports', version: 1, reports: readLiveTextReports(workspaceId) }, null, 2);
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'utm-live-text-reports.json'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
