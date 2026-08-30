import type { CustomFieldDefinition, CustomValue, Expression, Scalar, UniversalItem, ViewSortRule } from './types.js';

type TokenKind = 'number' | 'string' | 'identifier' | 'operator' | 'paren' | 'comma' | 'eof';
interface Token { kind: TokenKind; value: string; at: number }

const operators = ['&&', '||', '==', '!=', '>=', '<=', '>', '<', '+', '-', '*', '/', '%', '!', 'in'];
const precedence: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, in: 3,
  '>': 4, '>=': 4, '<': 4, '<=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
};

export class DslSyntaxError extends Error {
  constructor(message: string, readonly position: number) { super(`${message} at ${position}`); }
}

function tokenize(source: string): Token[] {
  const result: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i++;
      let value = '';
      let closed = false;
      while (i < source.length) {
        const next = source[i++]!;
        if (next === quote) { closed = true; break; }
        if (next === '\\') {
          const escaped = source[i++];
          if (escaped === undefined) throw new DslSyntaxError('Unterminated escape', i);
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
          value += escapes[escaped] ?? escaped;
        } else value += next;
      }
      if (!closed) throw new DslSyntaxError('Unterminated string', start);
      result.push({ kind: 'string', value, at: start });
      continue;
    }
    if (/\d/.test(c)) {
      const start = i;
      while (i < source.length && /[\d.]/.test(source[i]!)) i += 1;
      const value = source.slice(start, i);
      if (!/^\d+(\.\d+)?$/.test(value)) throw new DslSyntaxError('Invalid number', start);
      result.push({ kind: 'number', value, at: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_.]/.test(source[i]!)) i += 1;
      const value = source.slice(start, i);
      result.push({ kind: value === 'in' ? 'operator' : 'identifier', value, at: start });
      continue;
    }
    if (c === '(' || c === ')') { result.push({ kind: 'paren', value: c, at: i++ }); continue; }
    if (c === ',') { result.push({ kind: 'comma', value: c, at: i++ }); continue; }
    const operator = operators.find((candidate) => source.startsWith(candidate, i));
    if (operator) { result.push({ kind: 'operator', value: operator, at: i }); i += operator.length; continue; }
    throw new DslSyntaxError(`Unexpected character ${JSON.stringify(c)}`, i);
  }
  result.push({ kind: 'eof', value: '', at: i });
  return result;
}

export function parseExpression(source: string): Expression {
  const tokens = tokenize(source);
  let cursor = 0;
  const peek = () => tokens[cursor]!;
  const consume = () => tokens[cursor++]!;

  const parsePrimary = (): Expression => {
    const token = consume();
    if (token.kind === 'number') return { type: 'literal', value: Number(token.value) };
    if (token.kind === 'string') return { type: 'literal', value: token.value };
    if (token.kind === 'identifier') {
      if (token.value === 'true' || token.value === 'false') return { type: 'literal', value: token.value === 'true' };
      if (token.value === 'null') return { type: 'literal', value: null };
      if (peek().kind === 'paren' && peek().value === '(') {
        consume();
        const args: Expression[] = [];
        if (!(peek().kind === 'paren' && peek().value === ')')) {
          while (true) {
            args.push(parseBinary(0));
            if (peek().kind === 'comma') { consume(); continue; }
            break;
          }
        }
        const close = consume();
        if (close.kind !== 'paren' || close.value !== ')') throw new DslSyntaxError('Expected )', close.at);
        return { type: 'call', name: token.value, args };
      }
      return { type: 'identifier', path: token.value };
    }
    if (token.kind === 'operator' && (token.value === '!' || token.value === '-')) {
      return { type: 'unary', operator: token.value, argument: parsePrimary() };
    }
    if (token.kind === 'paren' && token.value === '(') {
      const expression = parseBinary(0);
      const close = consume();
      if (close.kind !== 'paren' || close.value !== ')') throw new DslSyntaxError('Expected )', close.at);
      return expression;
    }
    throw new DslSyntaxError('Expected expression', token.at);
  };

  const parseBinary = (minimum: number): Expression => {
    let left = parsePrimary();
    while (peek().kind === 'operator') {
      const operator = peek().value;
      const level = precedence[operator];
      if (level === undefined || level < minimum) break;
      consume();
      const right = parseBinary(level + 1);
      left = { type: 'binary', operator, left, right };
    }
    return left;
  };

  const expression = parseBinary(0);
  if (peek().kind !== 'eof') throw new DslSyntaxError('Unexpected token', peek().at);
  return expression;
}

export type EvalValue = Scalar | Scalar[] | Record<string, unknown> | undefined;
export interface EvaluationContext {
  item: UniversalItem;
  now?: Date;
  variables?: Record<string, EvalValue>;
  resolveItem?: (id: string) => UniversalItem | undefined;
  temporalOptions?: QueryTemporalOptions;
}

export interface DueDateBuckets {
  dueTodayOrOverdue: boolean;
  dueThisWeekOrOverdue: boolean;
  eventToday: boolean;
  eventThisWeek: boolean;
}

export interface QueryTemporalOptions { timeZone?: string | undefined; weekStartsOn?: 0 | 1 | undefined }

type SchedulePeriod = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'next_days' | 'custom';

function calendarDateKey(value: Date, timeZone?: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
}

function shiftCalendarDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function schedulePeriodBounds(period: SchedulePeriod, now: Date, options: QueryTemporalOptions, nextDays: number, customStart: string, customEnd: string): { start: string; end: string } | null {
  const today = calendarDateKey(now, options.timeZone);
  if (period === 'today') return { start: today, end: today };
  if (period === 'tomorrow') { const tomorrow = shiftCalendarDateKey(today, 1); return { start: tomorrow, end: tomorrow }; }
  if (period === 'next_days') return { start: today, end: shiftCalendarDateKey(today, Math.max(1, Math.floor(nextDays)) - 1) };
  if (period === 'custom') return /^\d{4}-\d{2}-\d{2}$/.test(customStart) && /^\d{4}-\d{2}-\d{2}$/.test(customEnd) && customStart <= customEnd ? { start: customStart, end: customEnd } : null;
  const [year, month, day] = today.split('-').map(Number);
  const ordinal = new Date(Date.UTC(year!, month! - 1, day!));
  const daysSinceWeekStart = (ordinal.getUTCDay() - (options.weekStartsOn ?? 1) + 7) % 7;
  const thisWeekStart = shiftCalendarDateKey(today, -daysSinceWeekStart);
  if (period === 'this_week') return { start: thisWeekStart, end: shiftCalendarDateKey(thisWeekStart, 6) };
  if (period !== 'next_week') return null;
  const nextWeekStart = shiftCalendarDateKey(thisWeekStart, 7);
  return { start: nextWeekStart, end: shiftCalendarDateKey(nextWeekStart, 6) };
}

function scheduleMatchesPeriod(item: UniversalItem, now: Date, options: QueryTemporalOptions, period: SchedulePeriod, sources: string, includeOverdue: boolean, nextDays: number, customStart: string, customEnd: string): boolean {
  const bounds = schedulePeriodBounds(period, now, options, nextDays, customStart, customEnd);
  if (!bounds) return false;
  const selected = new Set(sources.split(',').map((source) => source.trim()).filter(Boolean));
  const dateKey = (value: string | undefined) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? calendarDateKey(date, options.timeZone) : null;
  };
  const inPeriod = (key: string | null) => Boolean(key && key >= bounds.start && key <= bounds.end);
  const overlaps = (start: string | null, end: string | null) => Boolean(start && end && start <= end && start <= bounds.end && end >= bounds.start);
  const startKey = dateKey(item.schedule?.startAt);
  const endKey = dateKey(item.schedule?.endAt);
  const dueKey = dateKey(item.schedule?.dueAt);
  const startTime = item.schedule?.startAt ? Date.parse(item.schedule.startAt) : Number.NaN;
  const endTime = item.schedule?.endAt ? Date.parse(item.schedule.endAt) : Number.NaN;
  const dueTime = item.schedule?.dueAt ? Date.parse(item.schedule.dueAt) : Number.NaN;
  const matches = (selected.has('event_open') && inPeriod(startKey))
    || (selected.has('event') && Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime && overlaps(startKey, endKey))
    || (selected.has('active') && Number.isFinite(startTime) && Number.isFinite(dueTime) && dueTime >= startTime && overlaps(startKey, dueKey))
    || (selected.has('due') && inPeriod(dueKey));
  if (matches) return true;
  if (!includeOverdue || item.state !== 'open' || !item.schedule?.dueAt) return false;
  const due = new Date(item.schedule.dueAt).getTime();
  return Number.isFinite(due) && due < now.getTime();
}

/** Calendar buckets used by saved Views, evaluated in the workspace timezone. */
export function dueDateBuckets(item: UniversalItem, now = new Date(), options: QueryTemporalOptions = {}): DueDateBuckets {
  const due = item.schedule?.dueAt ? new Date(item.schedule.dueAt) : undefined;
  const todayKey = calendarDateKey(now, options.timeZone);
  const [year, month, day] = todayKey.split('-').map(Number);
  const todayOrdinal = new Date(Date.UTC(year!, month! - 1, day!));
  const weekStartsOn = options.weekStartsOn ?? 1;
  const daysSinceWeekStart = (todayOrdinal.getUTCDay() - weekStartsOn + 7) % 7;
  const weekStartOrdinal = new Date(todayOrdinal);
  weekStartOrdinal.setUTCDate(weekStartOrdinal.getUTCDate() - daysSinceWeekStart);
  todayOrdinal.setUTCDate(todayOrdinal.getUTCDate() + 6 - daysSinceWeekStart);
  const weekStartKey = weekStartOrdinal.toISOString().slice(0, 10);
  const weekEndKey = todayOrdinal.toISOString().slice(0, 10);
  const start = item.schedule?.startAt ? new Date(item.schedule.startAt) : undefined;
  const end = item.schedule?.endAt ? new Date(item.schedule.endAt) : start;
  const validEvent = Boolean(start && end && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end.getTime() >= start.getTime());
  const startKey = validEvent ? calendarDateKey(start!, options.timeZone) : '';
  const endKey = validEvent ? calendarDateKey(end!, options.timeZone) : '';
  const validDue = Boolean(due && Number.isFinite(due.getTime()));
  const dueKey = validDue ? calendarDateKey(due!, options.timeZone) : '';
  return {
    dueTodayOrOverdue: validDue && dueKey <= todayKey,
    dueThisWeekOrOverdue: validDue && dueKey <= weekEndKey,
    eventToday: validEvent && startKey <= todayKey && endKey >= todayKey,
    eventThisWeek: validEvent && startKey <= weekEndKey && endKey >= weekStartKey,
  };
}

function getPath(root: unknown, path: string): EvalValue {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current as EvalValue;
}

function number(value: EvalValue): number {
  if (typeof value !== 'number') throw new TypeError(`Expected number, received ${typeof value}`);
  return value;
}

function scalar(value: EvalValue): Scalar {
  if (Array.isArray(value) || (typeof value === 'object' && value !== null) || value === undefined) {
    throw new TypeError('Expected scalar');
  }
  return value;
}

const durationUnits: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000, Y: 31_536_000_000 };
export function durationToMs(value: string): number {
  const sign = value.startsWith('-') ? -1 : 1; const normalized = value.replace(/^-/, '');
  const short = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(normalized);
  if (short) return sign * Number(short[1]) * durationUnits[short[2]!]!;
  const iso = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(normalized);
  if (!iso) throw new TypeError(`Unsupported duration: ${value}`);
  return sign * (Number(iso[1] ?? 0) * durationUnits.Y! + Number(iso[2] ?? 0) * durationUnits.M! + Number(iso[3] ?? 0) * 86_400_000 + Number(iso[4] ?? 0) * 3_600_000 + Number(iso[5] ?? 0) * 60_000 + Number(iso[6] ?? 0) * 1_000);
}

function readableTimeDistance(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) throw new TypeError('Expected a valid date');
  const past = milliseconds < 0;
  let remaining = Math.abs(milliseconds);
  const units: Array<[string, number]> = [['y', durationUnits.Y!], ['mo', durationUnits.M!], ['d', durationUnits.d!], ['h', durationUnits.h!], ['m', durationUnits.m!], ['s', durationUnits.s!]];
  const parts: string[] = [];
  for (const [label, size] of units) {
    const amount = Math.floor(remaining / size);
    if (amount > 0) { parts.push(`${amount}${label}`); remaining -= amount * size; }
    if (parts.length === 2) break;
  }
  const result = parts.join(' ') || 'now';
  return past && result !== 'now' ? `${result} ago` : result;
}

function dateDistance(value: EvalValue, now: Date): number {
  const timestamp = new Date(String(value ?? '')).getTime();
  if (!Number.isFinite(timestamp)) throw new TypeError('Expected a valid date');
  return timestamp - now.getTime();
}

export function evaluateExpression(expression: Expression, context: EvaluationContext): EvalValue {
  switch (expression.type) {
    case 'literal': return expression.value;
    case 'identifier': {
      if (expression.path.startsWith('custom.')) return getPath(context.item.custom, expression.path.slice(7));
      return context.variables?.[expression.path] ?? getPath(context.item, expression.path);
    }
    case 'unary': {
      const value = evaluateExpression(expression.argument, context);
      return expression.operator === '!' ? !Boolean(value) : -number(value);
    }
    case 'binary': {
      if (expression.operator === '&&') return Boolean(evaluateExpression(expression.left, context)) && Boolean(evaluateExpression(expression.right, context));
      if (expression.operator === '||') return Boolean(evaluateExpression(expression.left, context)) || Boolean(evaluateExpression(expression.right, context));
      const left = evaluateExpression(expression.left, context);
      const right = evaluateExpression(expression.right, context);
      switch (expression.operator) {
        // A missing optional property is the same as an explicit JSON null for
        // filters. This makes `field == null` reliable for "not filled" views.
        case '==': return (Array.isArray(left) && !Array.isArray(right) ? left.includes(scalar(right)) : Array.isArray(right) && !Array.isArray(left) ? right.includes(scalar(left)) : (left === undefined && right === null) || (left === null && right === undefined) || JSON.stringify(left) === JSON.stringify(right));
        case '!=': return !(Array.isArray(left) && !Array.isArray(right) ? left.includes(scalar(right)) : Array.isArray(right) && !Array.isArray(left) ? right.includes(scalar(left)) : (left === undefined && right === null) || (left === null && right === undefined) || JSON.stringify(left) === JSON.stringify(right));
        case '>': return scalar(left)! > scalar(right)!;
        case '>=': return scalar(left)! >= scalar(right)!;
        case '<': return scalar(left)! < scalar(right)!;
        case '<=': return scalar(left)! <= scalar(right)!;
        case '+': return typeof left === 'string' || typeof right === 'string' ? `${String(left)}${String(right)}` : number(left) + number(right);
        case '-': return number(left) - number(right);
        case '*': return number(left) * number(right);
        case '/': return number(left) / number(right);
        case '%': return number(left) % number(right);
        case 'in': return Array.isArray(right) ? right.includes(scalar(left)) : String(right ?? '').includes(String(left ?? ''));
        default: throw new TypeError(`Unsupported operator: ${expression.operator}`);
      }
    }
    case 'call': {
      const args = expression.args.map((argument) => evaluateExpression(argument, context));
      const now = context.now ?? new Date();
      switch (expression.name) {
        case 'now': return now.toISOString();
        case 'today': return now.toISOString().slice(0, 10);
        case 'has': return args[0] !== undefined && args[0] !== null && args[0] !== '';
        case 'includes': return Array.isArray(args[0]) ? args[0].includes(scalar(args[1])) : String(args[0] ?? '').includes(String(args[1] ?? ''));
        case 'startsWith': return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
        case 'endsWith': return String(args[0] ?? '').endsWith(String(args[1] ?? ''));
        case 'lower': return String(args[0] ?? '').toLocaleLowerCase();
        case 'length': return Array.isArray(args[0]) || typeof args[0] === 'string' ? args[0].length : 0;
        case 'duration': return durationToMs(String(args[0] ?? ''));
        // Numeric helpers deliberately return whole units rounded away from
        // zero. They are useful in Views (for example `minutesUntil(...)`),
        // while `timeUntil` keeps the compact human-readable form.
        case 'millisecondsUntil': return dateDistance(args[0], now);
        case 'secondsUntil': return Math.ceil(dateDistance(args[0], now) / 1_000);
        case 'minutesUntil': return Math.ceil(dateDistance(args[0], now) / 60_000);
        case 'hoursUntil': return Math.ceil(dateDistance(args[0], now) / 3_600_000);
        case 'daysUntil': return Math.ceil(dateDistance(args[0], now) / 86_400_000);
        // A duration is always milliseconds. Choose Result: Duration in the
        // editor to render it as a friendly value in a View.
        case 'durationUntil': return dateDistance(args[0], now);
        case 'durationBetween': return new Date(String(args[1] ?? '')).getTime() - new Date(String(args[0] ?? '')).getTime();
        case 'formatDuration': return readableTimeDistance(number(args[0]));
        case 'timeUntil': return readableTimeDistance(dateDistance(args[0], now));
        case 'addDuration': return new Date(new Date(String(args[0])).getTime() + durationToMs(String(args[1] ?? ''))).toISOString();
        case 'scheduleInPeriod': return scheduleMatchesPeriod(
          context.item,
          now,
          context.temporalOptions ?? {},
          String(args[0] ?? 'today') as SchedulePeriod,
          String(args[1] ?? ''),
          Boolean(args[2]),
          Number(args[3] ?? 7),
          String(args[4] ?? ''),
          String(args[5] ?? ''),
        );
        case 'item': {
          const target = context.resolveItem?.(String(args[0] ?? ''));
          return target ? getPath(target, String(args[1] ?? '')) : undefined;
        }
        case 'linked': {
          const reference = String(args[0] ?? '');
          const relation = context.item.relations.find((entry) => entry.type === reference || entry.targetId === reference);
          const target = relation ? context.resolveItem?.(relation.targetId) : undefined;
          return target ? getPath(target, String(args[1] ?? '')) : undefined;
        }
        default: throw new TypeError(`Function is not allowed: ${expression.name}`);
      }
    }
  }
}

export interface QueryRelationContext { isSubtask?: boolean; isParent?: boolean; parentDepth?: number; childDepth?: number }
export function compileQuery(source: string, relationContext?: (item: UniversalItem) => QueryRelationContext, temporalOptions: QueryTemporalOptions = {}): (item: UniversalItem, now?: Date) => boolean {
  // Compatibility for early Views: before habits became a universal capability,
  // the visual builder expressed them as `preset == "habit"`.
  const activeQuery = 'state == "open" && role != "series_template" && isTemplate != true';
  const legacyToday = `${activeQuery} && dueTodayOrOverdue == true`;
  const legacyWeek = `${activeQuery} && dueThisWeekOrOverdue == true`;
  const compatibleSource = source === legacyToday ? `${activeQuery} && (eventToday == true || dueTodayOrOverdue == true)` : source === legacyWeek ? `${activeQuery} && (eventThisWeek == true || dueThisWeekOrOverdue == true)` : source;
  const normalizedSource = compatibleSource
    .replace(/\bpreset\s*==\s*(["'])habit\1/g, 'isHabit == true')
    .replace(/\bpreset\s*!=\s*(["'])habit\1/g, 'isHabit != true')
    // Keep the storage model backwards compatible while making the UI wording clearer.
    .replace(/\bstate\s*==\s*(["'])active\1/g, 'state == "open"')
    .replace(/\bstate\s*!=\s*(["'])active\1/g, 'state != "open"');
  const ast = parseExpression(normalizedSource);
  return (item, now) => {
    const current = now ?? new Date();
    const start = item.schedule?.startAt ? new Date(item.schedule.startAt).getTime() : undefined;
    const due = item.schedule?.dueAt ? new Date(item.schedule.dueAt).getTime() : undefined;
    const activeDuration = start !== undefined && !Number.isNaN(start) && due !== undefined && !Number.isNaN(due);
    const activeRange = (start === undefined || Number.isNaN(start) || current.getTime() >= start)
      && (due === undefined || Number.isNaN(due) || current.getTime() <= due);
    try {
      const relations = relationContext?.(item) ?? {};
      const dueBuckets = dueDateBuckets(item, current, temporalOptions);
      return Boolean(evaluateExpression(ast, { item, variables: { isHabit: Boolean(item.habit), isTemplate: item.extensions?.['utm:template'] === true, activeRange, activeDuration, ...dueBuckets, isSubtask: relations.isSubtask ?? false, isParent: relations.isParent ?? false, parentDepth: relations.parentDepth ?? 0, childDepth: relations.childDepth ?? 0 }, now: current, temporalOptions }));
    }
    catch (reason) {
      if (reason instanceof TypeError && /^Expected (scalar|number)/.test(reason.message)) return false;
      throw reason;
    }
  };
}

export function parseSortSource(source: string): ViewSortRule[] {
  return source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line, index) => {
    const match = /^(.*?)\s+(asc|desc)(?:\s+nulls\s+(first|last))?$/i.exec(line);
    if (!match?.[1] || !match[2]) throw new DslSyntaxError(`Invalid sort rule on line ${index + 1}`, 0);
    const expression = match[1].trim();
    parseExpression(expression);
    return {
      expression,
      direction: match[2].toLowerCase() as ViewSortRule['direction'],
      nulls: (match[3]?.toLowerCase() ?? 'last') as ViewSortRule['nulls'],
    };
  });
}

export function serializeSortRules(rules: ViewSortRule[]): string {
  return rules.map((rule) => `${rule.expression} ${rule.direction} nulls ${rule.nulls}`).join('\n');
}

function compareSortValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}

export function compileSort(source: string): (left: UniversalItem, right: UniversalItem, now?: Date) => number {
  const rules = parseSortSource(source).map((rule) => ({ ...rule, ast: parseExpression(rule.expression) }));
  return (left, right, now = new Date()) => {
    for (const rule of rules) {
      const leftValue = evaluateExpression(rule.ast, { item: left, now });
      const rightValue = evaluateExpression(rule.ast, { item: right, now });
      const leftNull = leftValue === undefined || leftValue === null || leftValue === '';
      const rightNull = rightValue === undefined || rightValue === null || rightValue === '';
      if (leftNull !== rightNull) return leftNull === (rule.nulls === 'first') ? -1 : 1;
      if (leftNull && rightNull) continue;
      const comparison = compareSortValues(leftValue, rightValue);
      if (comparison) return rule.direction === 'asc' ? comparison : -comparison;
    }
    return left.id.localeCompare(right.id);
  };
}

export interface FormulaResult { values: Record<string, CustomValue>; errors: Record<string, string> }

function referencedCustomFields(expression: Expression, target: Set<string>): void {
  if (expression.type === 'identifier' && expression.path.startsWith('custom.')) target.add(expression.path.slice(7));
  if (expression.type === 'unary') referencedCustomFields(expression.argument, target);
  if (expression.type === 'binary') { referencedCustomFields(expression.left, target); referencedCustomFields(expression.right, target); }
  if (expression.type === 'call') expression.args.forEach((arg) => referencedCustomFields(arg, target));
}

export function evaluateFormulas(item: UniversalItem, definitions: CustomFieldDefinition[], now = new Date()): FormulaResult {
  const formulas = new Map(definitions.filter((field) => field.kind === 'formula' && field.formula).map((field) => [field.key, field]));
  const values: Record<string, CustomValue> = { ...item.custom };
  const errors: Record<string, string> = {};
  const visiting = new Set<string>();
  const done = new Set<string>();
  const evaluate = (key: string): void => {
    if (done.has(key)) return;
    if (visiting.has(key)) { errors[key] = 'Formula cycle detected'; return; }
    const definition = formulas.get(key);
    if (!definition?.formula) return;
    visiting.add(key);
    try {
      const ast = parseExpression(definition.formula);
      const dependencies = new Set<string>();
      referencedCustomFields(ast, dependencies);
      dependencies.forEach(evaluate);
      if ([...dependencies].some((dependency) => errors[dependency])) throw new Error('Dependency contains an error');
      const computed = evaluateExpression(ast, { item: { ...item, custom: values }, now });
      if (computed === undefined || (typeof computed === 'object' && !Array.isArray(computed))) throw new TypeError('Formula returned an unsupported value');
      values[key] = computed as CustomValue;
      done.add(key);
    } catch (error) { if (!errors[key]) errors[key] = error instanceof Error ? error.message : String(error); }
    visiting.delete(key);
  };
  formulas.forEach((_definition, key) => evaluate(key));
  return { values, errors };
}

export interface ItemScriptResult { values: Record<string, EvalValue>; errors: Record<string, string> }

/** Evaluate item-local scripts with cycle detection and an optional workspace item resolver. */
export function evaluateItemScripts(
  item: UniversalItem,
  resolveItem?: (id: string) => UniversalItem | undefined,
  now = new Date(),
): ItemScriptResult {
  const scripts = new Map((item.scripts ?? []).map((script) => [script.key, script]));
  const values: Record<string, EvalValue> = {};
  const errors: Record<string, string> = {};
  const visiting = new Set<string>();
  const done = new Set<string>();
  const evaluate = (key: string): void => {
    if (done.has(key)) return;
    if (visiting.has(key)) { errors[key] = 'Script cycle detected'; return; }
    const script = scripts.get(key);
    if (!script) return;
    visiting.add(key);
    try {
      const ast = parseExpression(script.source);
      const dependencies = new Set<string>();
      const collect = (expression: Expression): void => {
        if (expression.type === 'identifier' && expression.path.startsWith('script.')) dependencies.add(expression.path.slice(7));
        if (expression.type === 'unary') collect(expression.argument);
        if (expression.type === 'binary') { collect(expression.left); collect(expression.right); }
        if (expression.type === 'call') expression.args.forEach(collect);
      };
      collect(ast);
      dependencies.forEach(evaluate);
      if ([...dependencies].some((dependency) => errors[dependency])) throw new Error('Dependency contains an error');
      const variables = Object.fromEntries(Object.entries(values).map(([name, value]) => [`script.${name}`, value]));
      const computed = evaluateExpression(ast, { item, now, variables, ...(resolveItem ? { resolveItem } : {}) });
      if (computed !== undefined && typeof computed === 'object' && !Array.isArray(computed)) throw new TypeError('Script returned an unsupported value');
      values[key] = computed;
      done.add(key);
    } catch (error) { if (!errors[key]) errors[key] = error instanceof Error ? error.message : String(error); }
    visiting.delete(key);
  };
  scripts.forEach((_script, key) => evaluate(key));
  return { values, errors };
}
