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

type EvalValue = Scalar | Scalar[] | Record<string, unknown> | undefined;
export interface EvaluationContext { item: UniversalItem; now?: Date; variables?: Record<string, EvalValue> }

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

const durationUnits: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
export function durationToMs(value: string): number {
  const short = /^(\d+(?:\.\d+)?)([smhdw])$/.exec(value);
  if (short) return Number(short[1]) * durationUnits[short[2]!]!;
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!iso) throw new TypeError(`Unsupported duration: ${value}`);
  return (Number(iso[1] ?? 0) * 86_400 + Number(iso[2] ?? 0) * 3_600 + Number(iso[3] ?? 0) * 60 + Number(iso[4] ?? 0)) * 1_000;
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
        case '==': return JSON.stringify(left) === JSON.stringify(right);
        case '!=': return JSON.stringify(left) !== JSON.stringify(right);
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
        case 'daysUntil': return Math.ceil((new Date(String(args[0])).getTime() - now.getTime()) / 86_400_000);
        default: throw new TypeError(`Function is not allowed: ${expression.name}`);
      }
    }
  }
}

export function compileQuery(source: string): (item: UniversalItem, now?: Date) => boolean {
  // Compatibility for early Views: before habits became a universal capability,
  // the visual builder expressed them as `preset == "habit"`.
  const normalizedSource = source
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
    const activeRange = (start === undefined || Number.isNaN(start) || current.getTime() >= start)
      && (due === undefined || Number.isNaN(due) || current.getTime() <= due);
    try { return Boolean(evaluateExpression(ast, { item, variables: { isHabit: Boolean(item.habit), isTemplate: item.extensions?.['utm:template'] === true, activeRange }, now: current })); }
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
