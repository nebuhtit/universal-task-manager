// Run after building core: node scripts/benchmark-calendar-date-keys.mjs
// Synthetic hot-path benchmark, not a measurement of workspace unlock time.
import assert from 'node:assert/strict';
import { calendarDateKey } from '../packages/core/dist/index.js';

const dates = Array.from({ length: 5000 }, (_, index) => new Date(1788796800000 + index * 60000));
const zones = ['Europe/Moscow', 'America/New_York', 'Asia/Tokyo'];
function uncached(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
}
function measure(format) {
  const start = performance.now();
  const output = dates.map((date, index) => format(date, zones[index % zones.length]));
  return { ms: Math.round(performance.now() - start), output };
}
const before = measure(uncached);
const after = measure(calendarDateKey);
assert.deepEqual(after.output, before.output);
console.log(JSON.stringify({ calls: dates.length, uncachedMs: before.ms, cachedMs: after.ms, identicalResults: true }));
