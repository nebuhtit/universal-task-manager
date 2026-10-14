import { recordDiagnostic } from '../../services/diagnostics';

const operations = ['Weather lifecycle', 'Weather forecast', 'Weather storage', 'Weather location search', 'Weather geolocation'];
const codes = ['network', 'timeout', 'invalid-response', 'storage', 'disabled', 'missing-location', 'started', 'completed', 'not-supported', 'denied', 'unavailable'];
export function safeWeatherDetails(details?: string): string | undefined {
  try {
    const value = JSON.parse(details ?? '{}');
    const safe: Record<string, string | number | boolean> = {};
    for (const key of ['enabled', 'solar', 'precipitation', 'hasLocation', 'hasCache', 'cacheUsable'] as const) if (typeof value?.[key] === 'boolean') safe[key] = value[key];
    for (const key of ['hours', 'results', 'cacheAgeMs'] as const) if (typeof value?.[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) safe[key] = Math.floor(value[key]);
    if (typeof value?.code === 'string' && (codes.includes(value.code) || /^http-[1-5]\d{2}$/.test(value.code))) safe.code = value.code;
    return Object.keys(safe).length ? JSON.stringify(safe) : undefined;
  } catch { return undefined; }
}
export function weatherDiagnostic(operation: typeof operations[number], details: Record<string, unknown>, durationMs?: number, failed = false) {
  if (!operations.includes(operation)) return;
  const safe = safeWeatherDetails(JSON.stringify(details));
  recordDiagnostic({ kind: failed ? 'error' : 'result', operation, message: operation, outcome: failed ? 'failed' : 'succeeded', ...(durationMs === undefined ? {} : { durationMs: Math.max(0, Math.round(durationMs)) }), ...(safe ? { details: safe } : {}) });
}
