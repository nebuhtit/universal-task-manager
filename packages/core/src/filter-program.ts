import { parseExpression } from './dsl.js';
import { validateFilterProgram } from './filter-validation.js';
export { validateFilterProgram } from './filter-validation.js';
import type { Expression } from './types.js';

const literal = (value: boolean | string | number | null): Expression => ({ type: 'literal', value });
export const conditionalExpression = (condition: Expression, yes: Expression, no: Expression): Expression => ({ type: 'call', name: 'if', args: [condition, yes, no] });
export function expressionToDsl(node: Expression): string {
  switch (node.type) {
    case 'literal': return JSON.stringify(node.value);
    case 'identifier': return node.path;
    case 'unary': return `${node.operator}(${expressionToDsl(node.argument)})`;
    case 'binary': return `(${expressionToDsl(node.left)} ${node.operator} ${expressionToDsl(node.right)})`;
    case 'call': return `${node.name}(${node.args.map(expressionToDsl).join(', ')})`;
  }
}

const aliases: Record<string, string> = { choose: 'if', schedule_in_period: 'scheduleInPeriod', next_reminder_in_period: 'nextReminderInPeriod', regex_match: 'regexMatch' };

type Token = { value: string; string?: boolean };
function tokenize(source: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < source.length;) {
    if (/\s/.test(source[i]!)) { i++; continue; }
    const raw = source[i] === 'r' && ['"', "'"].includes(source[i + 1]!);
    if (raw || ['"', "'"].includes(source[i]!)) {
      if (raw) i++;
      const quote = source[i++]; let value = ''; let closed = false;
      while (i < source.length) {
        const c = source[i++]!;
        if (c === quote) { closed = true; break; }
        if (c === '\\') {
          const next = source[i++]; if (next === undefined) break;
          value += raw ? `\\${next}` : ({ n: '\n', t: '\t', r: '\r' }[next] ?? (['\\', '"', "'"].includes(next) ? next : `\\${next}`));
        } else value += c;
      }
      if (!closed) throw new Error('Unterminated string');
      out.push({ value, string: true }); continue;
    }
    const match = /^(?:[a-zA-Z_][\w.]*|\d+(?:\.\d+)?|==|!=|<=|>=|[()+*/%,<>-])/.exec(source.slice(i));
    if (!match) throw new Error(`Unexpected text: ${source.slice(i, i + 16)}`);
    out.push({ value: match[0] }); i += match[0].length;
  }
  out.push({ value: '' }); return out;
}

export function pythonExpression(source: string): Expression {
  const tokens = tokenize(source); let at = 0;
  const peek = () => tokens[at]!.value;
  const take = () => tokens[at++]!;
  const expect = (value: string) => { if (take().value !== value) throw new Error(`Expected ${value}`); };
  const priorities: Record<string, number> = { or: 1, and: 2, '==': 4, '!=': 4, '>': 4, '<': 4, '>=': 4, '<=': 4, in: 4, not: 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };
  let nesting = 0;
  const parse = (minimum = 0): Expression => {
    if (++nesting > 32) throw new Error('Expression is too deeply nested');
    const token = take(); let left: Expression;
    if (token.string) left = literal(token.value);
    else if (/^\d/.test(token.value)) left = literal(Number(token.value));
    else if (['True', 'False', 'None', 'true', 'false', 'null'].includes(token.value)) left = literal(['True', 'true'].includes(token.value) ? true : ['False', 'false'].includes(token.value) ? false : null);
    else if (token.value === 'not' || token.value === '-') left = { type: 'unary', operator: token.value === 'not' ? '!' : '-', argument: parse(token.value === 'not' ? 3 : 7) };
    else if (token.value === '(') { left = parse(); expect(')'); }
    else if (/^[a-zA-Z_]/.test(token.value)) {
      if (peek() === '(') {
        take(); const args: Expression[] = [];
        if (peek() !== ')') {
          args.push(parse());
          if (['any', 'all'].includes(token.value) && peek() === 'for') {
            take(); const variable = take().value; expect('in'); const collection = parse(); expect(')');
            left = { type: 'call', name: token.value === 'any' ? 'anyWhere' : 'allWhere', args: [collection, literal(variable), args[0]!] };
          } else {
            while (peek() === ',') { take(); args.push(parse()); }
            expect(')'); left = { type: 'call', name: aliases[token.value] ?? token.value, args };
          }
        } else { take(); left = { type: 'call', name: aliases[token.value] ?? token.value, args }; }
      } else left = { type: 'identifier', path: token.value.replace(/^item\./, '') };
    } else throw new Error(`Expected expression, got ${token.value || 'end of line'}`);
    while ((priorities[peek()] ?? -1) >= minimum) {
      const operator = take().value;
      if (operator === 'not') expect('in');
      const right = parse(priorities[operator]! + 1);
      if (operator === 'in' || operator === 'not') {
        left = { type: 'call', name: 'includes', args: [right, left] };
        if (operator === 'not') left = { type: 'unary', operator: '!', argument: left };
      } else left = { type: 'binary', operator: operator === 'and' ? '&&' : operator === 'or' ? '||' : operator, left, right };
    }
    nesting--; return left;
  };
  const result = parse(); if (peek()) throw new Error(`Unexpected ${peek()}`);
  validateFilterProgram(result); return result;
}

/** A bounded, expression-only language. No Python runtime, imports or mutation. */
export function pythonToFilter(source: string): string {
  if (source.length > 32768) throw new Error('Filter code exceeds 32768 characters');
  const lines = source.split('\n').map((text, index) => {
    // Comments are ignored only outside quoted strings.
    let quote = ''; let escaped = false; let end = text.length;
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (escaped) { escaped = false; continue; }
      if (c === '\\' && quote) { escaped = true; continue; }
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '#') { end = i; break; }
    }
    if (/^\s*\t/.test(text)) throw new Error(`Line ${index + 1}: use spaces, not tabs`);
    return { text: text.slice(0, end).trim(), indent: text.length - text.trimStart().length, number: index + 1 };
  }).filter((line) => line.text);
  let cursor = 0;
  type Statement = { result: Expression } | { condition: Expression; yes: Statement[]; no: Statement[] };
  const block = (indent: number, depth: number): Statement[] => {
    if (depth > 24) throw new Error('Too many nested blocks');
    const statements: Statement[] = [];
    const body = (): Statement[] => {
      if (!lines[cursor] || lines[cursor]!.indent <= indent) throw new Error('Expected an indented block');
      return block(lines[cursor]!.indent, depth + 1);
    };
    const branch = (condition: string): Statement => {
      const yes = body(); let no: Statement[] = [];
      const next = lines[cursor];
      if (next?.indent === indent && /^elif .+:$/.test(next.text)) { cursor++; no = [branch(next.text.slice(5, -1))]; }
      else if (next?.indent === indent && next.text === 'else:') { cursor++; no = body(); }
      return { condition: pythonExpression(condition), yes, no };
    };
    while (cursor < lines.length && lines[cursor]!.indent === indent) {
      const line = lines[cursor]!;
      if (/^(elif |else:)/.test(line.text)) break;
      cursor++;
      try {
        if (/^if .+:$/.test(line.text)) statements.push(branch(line.text.slice(3, -1)));
        else if (line.text.startsWith('return ')) statements.push({ result: pythonExpression(line.text.slice(7)) });
        else if (lines.length === 1) statements.push({ result: pythonExpression(line.text) });
        else throw new Error('Use if / elif / else and return expressions');
      } catch (error) { throw new Error(`Line ${line.number}: ${(error as Error).message}`); }
    }
    return statements;
  };
  if (!lines.length) return 'true';
  if (lines[0]!.indent !== 0) throw new Error('First statement must not be indented');
  const statements = block(0, 0);
  if (cursor < lines.length) throw new Error(`Line ${lines[cursor]!.number}: unexpected indentation or branch`);
  const lower = (list: Statement[], fallback: Expression): Expression => list.reduceRight<Expression>((next, statement) => 'result' in statement ? statement.result : conditionalExpression(statement.condition, lower(statement.yes, next), lower(statement.no, next)), fallback);
  const result = lower(statements, literal(false)); validateFilterProgram(result);
  return expressionToDsl(result);
}

export function expressionToPython(node: Expression): string {
  switch (node.type) {
    case 'literal': return node.value === true ? 'True' : node.value === false ? 'False' : node.value === null ? 'None' : JSON.stringify(node.value);
    case 'identifier': return node.path;
    case 'unary': return `${node.operator === '!' ? 'not ' : '-'}(${expressionToPython(node.argument)})`;
    case 'binary': return `(${expressionToPython(node.left)} ${{ '&&': 'and', '||': 'or' }[node.operator] ?? node.operator} ${expressionToPython(node.right)})`;
    case 'call': {
      if (['anyWhere', 'allWhere'].includes(node.name) && node.args[1]?.type === 'literal') return `${node.name === 'anyWhere' ? 'any' : 'all'}(${expressionToPython(node.args[2]!)} for ${node.args[1].value} in ${expressionToPython(node.args[0]!)})`;
      return `${node.name === 'if' ? 'choose' : node.name}(${node.args.map(expressionToPython).join(', ')})`;
    }
  }
}
export function filterToPython(source: string): string {
  const render = (node: Expression, indent: string): string => {
    if (node.type !== 'call' || node.name !== 'if') return `${indent}return ${expressionToPython(node)}`;
    const otherwise = node.args[2]!;
    return `${indent}if ${expressionToPython(node.args[0]!)}:\n${render(node.args[1]!, indent + '    ')}\n${otherwise.type === 'call' && otherwise.name === 'if' ? indent + 'el' + render(otherwise, indent).slice(indent.length) : indent + 'else:\n' + render(otherwise, indent + '    ')}`;
  };
  return render(parseExpression(source || 'true'), '');
}
