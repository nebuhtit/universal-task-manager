/** Only fixed categories and bundled code locations may leave the device. */
const categories = ['chunk-load', 'react-hooks', 'react-update-loop', 'invalid-date', 'stack-overflow', 'type-error', 'reference-error', 'unexpected'] as const;
const locationPattern = /^assets\/[A-Za-z0-9_-]+\.js:\d+(?::\d+)?$/;
export function renderFailureDetails(reason: unknown): string {
  const error = reason instanceof Error ? reason : undefined;
  const message = error?.message ?? '';
  const category = /importing a module|dynamically imported module|loading chunk|load module script/i.test(message) ? 'chunk-load'
    : /hooks|react error #(300|310|311)/i.test(message) ? 'react-hooks'
    : /maximum update depth|too many re-renders|react error #(185|301)/i.test(message) ? 'react-update-loop'
    : /invalid (time|date)/i.test(message) ? 'invalid-date'
    : /call stack|too much recursion/i.test(message) ? 'stack-overflow'
    : error instanceof TypeError ? 'type-error' : error instanceof ReferenceError ? 'reference-error' : 'unexpected';
  // No exception messages, function names, URL hosts, queries or local paths.
  const frames = [...(error?.stack ?? '').matchAll(/\/assets\/([A-Za-z0-9_-]+\.js:\d+(?::\d+)?)/g)].slice(0, 5).map(match => `assets/${match[1]}`);
  return JSON.stringify({ category, frames });
}
export function safeRenderFailureDetails(details: string | undefined): string | undefined {
  try {
    const value = JSON.parse(details ?? '') as { category?: unknown; frames?: unknown };
    if (!categories.includes(value.category as typeof categories[number])) return undefined;
    const frames = Array.isArray(value.frames) ? value.frames.filter((frame): frame is string => typeof frame === 'string' && frame.length < 160 && locationPattern.test(frame)).slice(0, 5) : [];
    return JSON.stringify({ category: value.category, frames });
  } catch { return undefined; }
}
