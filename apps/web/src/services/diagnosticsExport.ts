import { readDiagnostics, safeGoogleCalendarFailureDetails, type DiagnosticEntry } from './diagnostics';
import { readPerformanceProfiles } from './performanceProfile';
import { readSyncTrace } from './syncTrace';
import { readStartupLog } from './startupDiagnostics';
import { safeItemTitleFailureDetails } from '../features/items/editor/itemEditorDiagnostics';
import { safeRenderFailureDetails } from './renderFailure';
import { safeWeatherDetails } from '../features/weather/weatherDiagnostics';

export const exportSafeDiagnostics = (): DiagnosticEntry[] => [...readPerformanceProfiles().map(profile => ({ at: profile.at, kind: 'usage' as const, message: 'Performance profile', operation: 'Performance profile v1', details: JSON.stringify(profile) })), ...readSyncTrace().map(entry => ({ at: entry.at, kind: 'result' as const, message: `Sync trace ${entry.event}`, operation: 'Sync trace v1', details: JSON.stringify(entry) })), ...readStartupLog().map((entry) => ({ at: entry.at, kind: 'result' as const, message: `Startup ${entry.stage} ${entry.phase}`, operation: `Startup ${entry.source}`, durationMs: entry.elapsedMs, details: JSON.stringify(entry) })), ...readDiagnostics().map(({ details, ...entry }) => {
  if (/^WebDAV (connection|sync|log upload)$/.test(entry.operation ?? '')) {
    if (details && /^webdav-[a-z0-9-]{1,80}$/.test(details)) return { ...entry, details };
    try {
      const value = JSON.parse(details ?? '') as { code?: unknown; network?: unknown };
      if (typeof value.code === 'string' && /^webdav-[a-z0-9-]{1,80}$/.test(value.code) && ['wifi', 'cellular', 'ethernet', 'none', 'unknown'].includes(String(value.network))) {
        return { ...entry, details: JSON.stringify({ code: value.code, network: value.network }) };
      }
    } catch { /* Discard non-whitelisted details. */ }
    return entry;
  }
  if (/^Weather (lifecycle|forecast|storage|location search|geolocation)$/.test(entry.operation ?? '')) {
    const safe = safeWeatherDetails(details);
    return { ...entry, ...(safe ? { details: safe } : {}) };
  }
  if (entry.operation === 'Workspace encryption mode change') {
    try {
      const value = JSON.parse(details ?? '') as { mode?: unknown };
      const mode = value.mode === 'encrypted' || value.mode === 'plaintext' ? value.mode : undefined;
      return { ...entry, ...(mode ? { details: JSON.stringify({ mode }) } : {}) };
    } catch {
      return details && ['password-or-encrypted-data', 'browser-storage', 'workspace-document', 'recurrence-processing', 'unexpected'].includes(details)
        ? { ...entry, details }
        : entry;
    }
  }
  if (entry.operation === 'Item title validation') {
    const safeDetails = safeItemTitleFailureDetails(details);
    return { ...entry, ...(safeDetails ? { details: safeDetails } : {}) };
  }
  if (entry.operation === 'Render page' || entry.operation === 'Render application') {
    const safeDetails = safeRenderFailureDetails(details);
    return { ...entry, ...(safeDetails ? { details: safeDetails } : {}) };
  }
  if (/google|calendar/i.test(`${entry.operation} ${entry.message}`)) {
    const safeDetails = entry.outcome === 'failed' ? safeGoogleCalendarFailureDetails(details) : undefined;
    return { ...entry, message: 'External calendar operation details omitted from export', ...(safeDetails ? { details: safeDetails } : {}) };
  }
  // Failure categories are intentionally finite and contain no workspace
  // content. Preserve them so an exported log can identify the failing stage.
  return details && ['password-or-encrypted-data', 'browser-storage', 'workspace-document', 'recurrence-processing', 'unexpected'].includes(details)
    ? { ...entry, details }
    : entry;
})];
