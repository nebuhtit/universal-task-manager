import { APP_VERSION, type UniversalItem } from '@utm/core';
import { recordDiagnostic } from '../../../services/diagnostics';
import { quickEntrySource } from '../quickEntry';

const flags = ['hasStart', 'hasEnd', 'hasExternalStart', 'hasExternalEnd', 'hasSource', 'missingTitle', 'missingStart', 'missingEnd', 'native', 'dirty'] as const;
const counts = ['draftLength', 'itemTitleLength', 'sourceLength'] as const;

/** Strict export allowlist: no title, date, ID or exception text leaves the editor. */
export function safeItemTitleFailureDetails(details?: string): string | undefined {
  try {
    const value = JSON.parse(details ?? '') as Record<string, unknown>;
    if (!value || !['commit', 'save-validation', 'source'].includes(String(value.stage))) return undefined;
    const safe: Record<string, unknown> = { stage: value.stage };
    for (const key of flags) if (typeof value[key] === 'boolean') safe[key] = value[key];
    for (const key of counts) if (typeof value[key] === 'number' && Number.isInteger(value[key]) && value[key] >= 0) safe[key] = Math.min(value[key], 100_000);
    if (typeof value.commit === 'string' && /^(?:local|[a-f\d]{7,40})$/.test(value.commit)) safe.commit = value.commit;
    if (typeof value.version === 'string' && /^\d+\.\d+\.\d+$/.test(value.version)) safe.version = value.version;
    return JSON.stringify(safe);
  } catch { return undefined; }
}

export function recordItemTitleFailure(stage: 'commit' | 'save-validation' | 'source', item: UniversalItem, text: string, reason: unknown): void {
  const source = quickEntrySource(item);
  const message = reason instanceof Error ? reason.message : String(reason);
  const details = safeItemTitleFailureDetails(JSON.stringify({
    stage, version: APP_VERSION, commit: import.meta.env.VITE_COMMIT_SHA ?? 'local',
    native: import.meta.env.VITE_NATIVE_IOS === 'true', dirty: import.meta.env.VITE_BUILD_DIRTY === true,
    draftLength: text.length, itemTitleLength: item.title.length, sourceLength: source?.text.length ?? 0,
    hasStart: Boolean(item.schedule?.startAt), hasEnd: Boolean(item.schedule?.endAt),
    hasExternalStart: Boolean(item.external?.startAt), hasExternalEnd: Boolean(item.external?.endAt), hasSource: Boolean(source),
    missingTitle: message.includes('Добавьте название.'), missingStart: message.includes('Для дороги нужно время начала.'),
    missingEnd: message.includes('Для дороги обратно нужно время конца события.'),
  }));
  recordDiagnostic({ kind: 'error', operation: 'Item title validation', message: 'Title draft retained after validation failure', outcome: 'failed', ...(details ? { details } : {}) });
}
