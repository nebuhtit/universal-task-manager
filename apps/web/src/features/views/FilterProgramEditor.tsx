import { useEffect, useId, useRef, useState } from 'react';
import { conditionalExpression, expressionToDsl, expressionToPython, filterToPython, orderedListNames, orderedOrganizationNames, orderedTagEntries, parseExpression, pythonToFilter, validateFilterProgram, type Expression, type WorkspaceDocument } from '@utm/core';
import { Button, Checkbox, Field, Input, Select, Textarea } from '../../components/ui/primitives';
import { SearchableDisclosureList } from '../../components/ui/SearchableDisclosureList';
import { viewFieldOptions } from './fieldCatalog';
import { ReminderPeriodEditor, SchedulePeriodEditor } from './SchedulePeriodEditor';
import { defaultSchedulePeriodValue, defaultVisualConditionForField, isOrganizationChoiceField, parseVisualRows, reminderPeriodField, schedulePeriodField, serializeVisualRows, visualFieldKind, visualFilterFieldLabel, visualFilterValueLabel, visualOperators, visualOptionsForField, type VisualConditionRow } from './visualFilterModel';
import './filter-program.css';

const yes: Expression = { type: 'literal', value: true };
const no: Expression = { type: 'literal', value: false };
const rule = (): Expression => parseExpression('state == "open"');
const flatten = (node: Expression, operator: string): Expression[] => node.type === 'binary' && node.operator === operator ? [...flatten(node.left, operator), ...flatten(node.right, operator)] : [node];
const fold = (operator: string, children: Expression[]): Expression => children.length ? children.slice(1).reduce<Expression>((left, right) => ({ type: 'binary', operator, left, right }), children[0]!) : operator === '&&' ? yes : no;

function FilterBlock({ node, onChange, workspace, depth = 0 }: { node: Expression; onChange: (node: Expression) => void; workspace: WorkspaceDocument; depth?: number }) {
  const uiId = useId();
  const ru = workspace.calendarPreferences.language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const child = (value: Expression, update: (next: Expression) => void) => <FilterBlock node={value} onChange={update} workspace={workspace} depth={depth + 1} />;
  const fields = viewFieldOptions(workspace);
  const parsed = parseVisualRows(expressionToDsl(node), workspace.customFields);
  const row = parsed?.length === 1 ? parsed[0] : undefined;
  const updateRow = (patch: Partial<VisualConditionRow>) => {
    if (!row) return;
    const next = { ...row, ...patch };
    if (patch.field) Object.assign(next, defaultVisualConditionForField(patch.field, workspace.customFields));
    onChange(parseExpression(serializeVisualRows([next], workspace.customFields)));
  };
  const fieldSelect = (value: string, update: (value: string) => void, periods = true) => <Select aria-label={t('Property', 'Свойство')} value={value} onChange={(event) => update(event.target.value)}>
    {!fields.some((field) => field.path === value) && ![schedulePeriodField, reminderPeriodField].includes(value) && <option value={value}>{value}</option>}
    {periods && <optgroup label={t('Time periods', 'Периоды')}><option value={schedulePeriodField}>Schedule in period</option><option value={reminderPeriodField}>Next reminder in period</option></optgroup>}
    {[...new Set(fields.map((field) => field.group))].map((section) => <optgroup label={section} key={section}>{fields.filter((field) => field.group === section).map((field) => <option key={field.path} value={field.path}>{visualFilterFieldLabel(field.path, field.label)}</option>)}</optgroup>)}
  </Select>;
  const orgOptions = (field: string) => field === 'area' ? orderedOrganizationNames(workspace, 'area') : field === 'project' ? orderedOrganizationNames(workspace, 'project') : field === 'list' ? orderedListNames(workspace) : orderedTagEntries(workspace).filter((tag): tag is string => tag !== null);
  const updateOperator = (operator: string) => {
    if (!row) return;
    const needsOrganizationValue = isOrganizationChoiceField(row.field) && !['is set', 'is not set'].includes(operator);
    // An empty organization comparison serializes to `true`. Seed it with an
    // existing choice so changing `Tags: is set` to `==` stays an editable
    // condition instead of unexpectedly turning into a Result block.
    const value = needsOrganizationValue && !row.value.trim() ? orgOptions(row.field)[0] ?? '' : row.value;
    updateRow({ operator, value });
  };
  const regex = node.type === 'call' && node.name === 'regexMatch' ? node : undefined;
  const isGroup = node.type === 'binary' && ['&&', '||'].includes(node.operator);
  const children = isGroup ? flatten(node, node.operator) : [];
  return <div className="filter-block">
    {isGroup ? <>
      <Field label={t('Group', 'Группа')}><Select value={node.operator} onChange={(event) => onChange(fold(event.target.value, children))}><option value="&&">AND — {t('all conditions', 'все условия')}</option><option value="||">OR — {t('any condition', 'любое условие')}</option></Select></Field>
      {children.map((entry, index) => <div className="filter-child" key={index}>{index > 0 && <div className={`filter-join filter-join-${node.operator === '&&' ? 'and' : 'or'}`} aria-label={node.operator === '&&' ? 'AND' : 'OR'}><span>{node.operator === '&&' ? 'AND' : 'OR'}</span></div>}{child(entry, (next) => onChange(fold(node.operator, children.map((value, at) => at === index ? next : value))))}<Button size="compact" onClick={() => onChange(fold(node.operator, children.filter((_, at) => at !== index)))}>{t('Remove condition', 'Удалить условие')}</Button></div>)}
      <Button size="compact" onClick={() => onChange(fold(node.operator, [...children, rule()]))}>+ {t('Condition', 'Условие')}</Button>
    </> : node.type === 'call' && node.name === 'if' ? <>
      <strong>IF</strong>{child(node.args[0]!, (condition) => onChange(conditionalExpression(condition, node.args[1]!, node.args[2]!)))}
      <strong>THEN</strong>{child(node.args[1]!, (result) => onChange(conditionalExpression(node.args[0]!, result, node.args[2]!)))}
      <strong>{node.args[2]?.type === 'call' && node.args[2].name === 'if' ? 'ELIF / ELSE' : 'ELSE'}</strong>{child(node.args[2]!, (result) => onChange(conditionalExpression(node.args[0]!, node.args[1]!, result)))}
      <Button size="compact" onClick={() => onChange(conditionalExpression(node.args[0]!, node.args[1]!, conditionalExpression(rule(), yes, node.args[2]!)))}>+ ELIF</Button>
    </> : node.type === 'unary' && node.operator === '!' ? <><strong>NOT</strong>{child(node.argument, (argument) => onChange({ ...node, argument }))}<Button size="compact" onClick={() => onChange(node.argument)}>{t('Remove NOT', 'Убрать NOT')}</Button></> : node.type === 'call' && ['anyWhere', 'allWhere'].includes(node.name) ? <>
      <Field label={t('Collection condition', 'Условие для коллекции')}><Select value={node.name} onChange={(event) => onChange({ ...node, name: event.target.value })}><option value="anyWhere">ANY</option><option value="allWhere">ALL</option></Select></Field>
      <Field label={t('Collection', 'Коллекция')}><Select value={node.args[0]?.type === 'identifier' ? node.args[0].path : 'tags'} onChange={(event) => onChange({ ...node, args: [{ type: 'identifier', path: event.target.value }, node.args[1]!, node.args[2]!] })}>{['tags', 'areas', 'projects', 'contexts', 'relations', 'reminders', 'attachments'].map((value) => <option key={value}>{value}</option>)}</Select></Field>
      <small>{t('Variable', 'Переменная')}: {node.args[1]?.type === 'literal' ? String(node.args[1].value) : 'entry'}</small>
      {child(node.args[2]!, (predicate) => onChange({ ...node, args: [node.args[0]!, node.args[1]!, predicate] }))}
    </> : regex ? <>
      <Field label={t('Operator', 'Оператор')}><Select value="regex" onChange={(event) => {
        if (event.target.value === 'not_regex') { onChange({ type: 'unary', operator: '!', argument: regex }); return; }
        if (event.target.value === 'regex') return;
        const field = regex.args[0]?.type === 'identifier' ? regex.args[0].path : 'title';
        onChange(parseExpression(serializeVisualRows([{ id: 'regex-replacement', join: 'and', field, ...defaultVisualConditionForField(field, workspace.customFields), operator: event.target.value }], workspace.customFields)));
      }}><option value="regex">{t('matches regex', 'соответствует regex')}</option><option value="not_regex">{t('does not match regex', 'не соответствует regex')}</option>{visualOperators(regex.args[0]?.type === 'identifier' ? regex.args[0].path : 'title', workspace.customFields).map((operator) => <option key={operator}>{operator}</option>)}</Select></Field>
      <Field label={t('Property', 'Свойство')}>{fieldSelect(regex.args[0]?.type === 'identifier' ? regex.args[0].path : 'title', (path) => onChange({ ...regex, args: [{ type: 'identifier', path }, ...regex.args.slice(1)] }), false)}</Field>
      <Field label={t('Regular expression (RE2)', 'Регулярное выражение (RE2)')}><Input value={regex.args[1]?.type === 'literal' ? String(regex.args[1].value) : ''} onChange={(event) => onChange({ ...regex, args: [regex.args[0]!, { type: 'literal', value: event.target.value }, regex.args[2] ?? no] })} /></Field>
      <Checkbox label={t('Ignore case', 'Без учёта регистра')} checked={regex.args[2]?.type === 'literal' && regex.args[2].value === true} onChange={(event) => onChange({ ...regex, args: [regex.args[0]!, regex.args[1]!, { type: 'literal', value: event.target.checked }] })} />
    </> : node.type === 'literal' && typeof node.value === 'boolean' ? <Field label={t('Result', 'Результат')}><Select value={String(node.value)} onChange={(event) => onChange(event.target.value === 'true' ? yes : no)}><option value="true">{t('Show / True', 'Показывать / True')}</option><option value="false">{t('Hide / False', 'Скрыть / False')}</option></Select></Field> : row ? <div className="filter-condition">
      <Field label={t('Property', 'Свойство')}>{fieldSelect(row.field, (field) => updateRow({ field }))}</Field>
      {row.field === schedulePeriodField ? <SchedulePeriodEditor value={row.value} onChange={(value) => updateRow({ value })} /> : row.field === reminderPeriodField ? <ReminderPeriodEditor value={row.value} onChange={(value) => updateRow({ value })} /> : <>
        <Field label={t('Operator', 'Оператор')}><Select value={row.operator} onChange={(event) => event.target.value === 'regex' ? onChange({ type: 'call', name: 'regexMatch', args: [{ type: 'identifier', path: row.field }, { type: 'literal', value: '' }, no] }) : updateOperator(event.target.value)}>{visualOperators(row.field, workspace.customFields).map((operator) => <option key={operator}>{operator}</option>)}<option value="regex">{t('matches regex', 'соответствует regex')}</option></Select></Field>
        {!['is set', 'is not set'].includes(row.operator) && <Field label={t('Value', 'Значение')}>{isOrganizationChoiceField(row.field) ? <SearchableDisclosureList uiKey={`filter-program:${uiId}`} summary={row.value || t('Choose values…', 'Выберите значения…')} items={orgOptions(row.field)} getSearchText={(value) => value} searchLabel={t('Search values', 'Поиск значений')} searchPlaceholder={t('Search', 'Поиск')} renderItem={(value) => <Checkbox label={value} checked={row.value.split(',').map((entry) => entry.trim()).includes(value)} onChange={(event) => { const selected = row.value.split(',').map((entry) => entry.trim()).filter(Boolean); updateRow({ value: (event.target.checked ? [...selected, value] : selected.filter((entry) => entry !== value)).join(', ') }); }} />} /> : visualOptionsForField(row.field, workspace.customFields) ? <Select value={row.value} onChange={(event) => updateRow({ value: event.target.value })}>{visualOptionsForField(row.field, workspace.customFields)!.map((value) => <option value={value} key={value}>{visualFilterValueLabel(row.field, value)}</option>)}</Select> : <Input value={row.value} type={visualFieldKind(row.field, workspace.customFields) === 'number' ? 'number' : visualFieldKind(row.field, workspace.customFields) === 'date' ? 'datetime-local' : 'text'} onChange={(event) => updateRow({ value: event.target.value })} />}</Field>}
      </>}
    </div> : <p className="filter-expression">{expressionToPython(node)}<small>{t('Preserved expression. Edit it in Code.', 'Выражение сохранено. Измените его во вкладке «Код».')}</small></p>}
    {depth < 20 && <div className="filter-block-actions">
      <Button size="compact" onClick={() => onChange({ type: 'binary', operator: '&&', left: node, right: rule() })}>+ AND</Button>
      <Button size="compact" onClick={() => onChange({ type: 'binary', operator: '||', left: node, right: rule() })}>+ OR</Button>
      <Button size="compact" onClick={() => onChange({ type: 'unary', operator: '!', argument: node })}>NOT</Button>
      <Button size="compact" onClick={() => onChange(conditionalExpression(node, yes, no))}>IF</Button>
      {node.type === 'literal' && <><Button size="compact" onClick={() => onChange(rule())}>{t('Condition', 'Условие')}</Button><Button size="compact" onClick={() => onChange(parseExpression(serializeVisualRows([{ id: 'period', join: 'and', field: schedulePeriodField, operator: 'matches', value: JSON.stringify(defaultSchedulePeriodValue()) }])))}>+ {t('Period', 'Период')}</Button><Button size="compact" onClick={() => onChange(parseExpression('anyWhere(tags, "entry", entry == "")'))}>ANY / ALL</Button></>}
      <Button size="compact" onClick={() => onChange({ type: 'binary', operator: '&&', left: node, right: parseExpression(serializeVisualRows([{ id: 'period', join: 'and', field: schedulePeriodField, operator: 'matches', value: JSON.stringify(defaultSchedulePeriodValue()) }])) })}>+ {t('Time period', 'Период')}</Button>
      <Button size="compact" onClick={() => onChange({ type: 'binary', operator: '&&', left: node, right: parseExpression('anyWhere(tags, "entry", entry == "")') })}>+ ANY / ALL</Button>
    </div>}
  </div>;
}

export function FilterProgramEditor({ source, python, workspace, onChange, onValidityChange }: { source: string; python?: string | undefined; workspace: WorkspaceDocument; onChange: (source: string, python: string) => void; onValidityChange: (valid: boolean) => void }) {
  const ru = workspace.calendarPreferences.language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const [mode, setMode] = useState<'blocks' | 'python' | 'dsl'>('blocks');
  const safePython = () => { try { return python && pythonToFilter(python) === expressionToDsl(parseExpression(source || 'true')) ? python : filterToPython(source); } catch { return ''; } };
  const [code, setCode] = useState(safePython);
  const [dsl, setDsl] = useState(source);
  const [node, setNode] = useState<Expression>(() => { try { return parseExpression(source || 'true'); } catch { return yes; } });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lastSource = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (source === lastSource.current) return;
    lastSource.current = source; setDsl(source); setCode(safePython());
    try { const next = parseExpression(source || 'true'); validateFilterProgram(next); setNode(next); setError(''); onValidityChange(true); }
    catch (reason) { setError(String(reason)); setMode('dsl'); onValidityChange(false); }
  }, [source]);
  const publish = (next: Expression, text?: string) => {
    setNode(next);
    try {
      validateFilterProgram(next);
      const nextSource = expressionToDsl(next); const nextCode = text ?? filterToPython(nextSource);
      lastSource.current = nextSource; setDsl(nextSource); setCode(nextCode); setError(''); onValidityChange(true); onChange(nextSource, nextCode);
    } catch (reason) { setError((reason as Error).message); onValidityChange(false); }
  };
  const editCode = (value: string, language: 'python' | 'dsl') => {
    if (language === 'python') setCode(value); else setDsl(value);
    try { publish(parseExpression(language === 'python' ? pythonToFilter(value) : value || 'true'), language === 'python' ? value : undefined); if (language === 'dsl') setDsl(value); }
    catch (reason) { setError((reason as Error).message); onValidityChange(false); }
  };
  return <div className="filter-program">
    <div className="filter-block-actions">{(['blocks', 'python', 'dsl'] as const).map((value) => <Button key={value} size="compact" aria-pressed={mode === value} disabled={Boolean(error) && mode !== value} onClick={() => setMode(value)}>{value === 'blocks' ? t('Blocks', 'Блоки') : value === 'python' ? t('Code (Python-like)', 'Код (как Python)') : 'Legacy DSL'}</Button>)}</div>
    <p className="field-hint">{t('Keep Schedule in period in a common AND group. Put state alternatives inside OR or IF. Only the first matching IF / ELIF branch is used. Completed items use their Schedule dates.', 'Оставьте Schedule in period в общей группе AND. Варианты статуса поместите внутрь OR или IF. Срабатывает только первая подходящая ветка IF / ELIF. Для завершённых используются даты Schedule.')}</p>
    {mode === 'blocks' ? <FilterBlock workspace={workspace} node={node} onChange={(next) => { if (code.includes('#')) setNotice(t('Code regenerated from blocks; comments were removed.', 'Код пересоздан из блоков; комментарии удалены.')); publish(next); }} /> : <Field label={mode === 'python' ? t('Filter code', 'Код фильтра') : 'Legacy DSL'}><Textarea spellCheck={false} rows={12} value={mode === 'python' ? code : dsl} onChange={(event) => editCode(event.target.value, mode)} /></Field>}
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <details><summary>{t('Examples and limits', 'Примеры и ограничения')}</summary><p>{t('A safe subset, not a Python interpreter. No imports, assignments or unbounded loops. RE2 regex does not support lookaround or backreferences.', 'Безопасное подмножество, не интерпретатор Python. Без импортов, присваиваний и неограниченных циклов. RE2 не поддерживает обратные ссылки и lookaround.')}</p><pre>{'if not scheduleInPeriod("today", "event_open,event,active,due", True, 7, "", ""):\n    return False\nif state == "done":\n    return True\nelif state == "open":\n    return activeRangeWhenSetOrOverdue\nelse:\n    return False\n\n# Collection example:\n# return any(regexMatch(entry, "^work", True) for entry in tags)'}</pre></details>
  </div>;
}
