import { RE2JS } from 're2js';

const cache = new Map<string, RE2JS>();
export function compileFilterRegex(pattern: string, ignoreCase = false): RE2JS {
  if (pattern.length > 2048) throw new Error('Regular expression is too long (maximum 2048 characters)');
  const key = JSON.stringify([pattern, ignoreCase]);
  let compiled = cache.get(key);
  if (!compiled) {
    compiled = RE2JS.compile(pattern, ignoreCase ? RE2JS.CASE_INSENSITIVE : 0);
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, compiled);
  }
  return compiled;
}
export function filterRegexMatches(value: unknown, pattern: string, ignoreCase = false): boolean {
  const compiled = compileFilterRegex(pattern, ignoreCase);
  return (Array.isArray(value) ? value : [value]).some((entry) => typeof entry === 'string' && compiled.matcher(entry).find());
}
