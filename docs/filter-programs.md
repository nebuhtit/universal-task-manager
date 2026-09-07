# Filter blocks and Python-like code — 1.99.12

## English

Open a View's **Visual setup**, or Calendar → **Edit calendar day view → Filter items**. Blocks, Code (Python-like), and Legacy DSL edit the same filter. Existing filters remain supported. Code comments are retained when saving/reopening; changing blocks regenerates code and removes comments with a notice.

- **AND** requires every child; **OR** requires at least one; **NOT** reverses a condition.
- **IF / ELIF / ELSE** chooses the first matching branch. A branch can return a condition, not only True/False.
- Keep `Schedule in period` outside status alternatives, in a common AND group. Adding `OR completed` at the top level bypasses other conditions.
- Completed items use their **Schedule** dates for the chosen period, not their completion timestamp. Calendar's selected-day boundary remains mandatory.
- `has(field)` checks presence; `includes(field, value)` checks containment. The ordinary visual operators also include “is set”, “contains”, and multi-value “has any / all / none”.
- `regexMatch(value, pattern, ignoreCase)` searches text (or each string in a collection). Wrap it in NOT for a negative match. Patterns use RE2 syntax; lookaround and backreferences are unsupported. Maximum pattern length: 2048 characters.

Example: completed and open items in the same Schedule period:

```python
# One common period for both statuses
if not scheduleInPeriod("today", "event_open,event,active,due", False, 7, "", ""):
    return False
if state == "done":
    return True
elif state == "open":
    return activeRangeWhenSetOrOverdue
else:
    return False
```

Use `True` instead of `False` in the third argument of `scheduleInPeriod` to include overdue items. Do not do that if you want only the selected period.

Finite collection examples:

```python
return any(regexMatch(tag, r"^work\b", True) for tag in item.tags)
```

```python
return all(tag != "hidden" for tag in tags)
```

This is a safe Python-like filter language, **not Python execution**. It supports expressions, `if / elif / else`, `return`, and finite `any / all` generators over tags, areas, projects, contexts, relations, reminders or attachments. No imports, assignments, arbitrary loops, I/O or network access. Empty `any` is False; empty `all` is True. Nested collection evaluation has a shared 20,000-iteration allowance. Expressions are single-line; indentation uses spaces. `item.title` and `title` refer to the same property. `choose(condition, yes, no)` represents a conditional embedded inside another expression.

The executable representation is still `query.source` (DSL); Python text is an optional editor sidecar. Both web and the offline Obsidian/iOS web bundles use the same evaluator. Invalid drafts cannot be saved.

## Русский

Откройте **Visual setup** у view или **Edit calendar day view → Filter items** в календаре. «Блоки», «Код (как Python)» и Legacy DSL редактируют один фильтр. Старые фильтры поддерживаются. Комментарии сохраняются при повторном открытии; изменение блоков пересоздаёт код и удаляет комментарии с предупреждением.

- **AND** — все условия; **OR** — хотя бы одно; **NOT** — отрицание.
- **IF / ELIF / ELSE** — первая подходящая ветка. Результатом может быть условие, а не только True/False.
- Период Schedule оставляйте в общей группе AND. Статусы open/completed помещайте во вложенную OR-группу или ветки IF. Верхнеуровневое `OR completed` обходит остальные условия.
- Для completed период проверяется по **Schedule**, не по времени завершения. В календаре ограничение выбранным днём остаётся обязательным.
- Проверка заполненности — `has`, поиск в тексте/списке — `includes`. В блоках используются обычные операторы «is set», «contains», «has any / all / none».
- Regex — `regexMatch(свойство, "шаблон", True)`. Последний аргумент включает игнорирование регистра; для отрицания используйте NOT. Поддерживается синтаксис RE2 без lookaround и обратных ссылок.

Пример выше показывает completed и open в одном периоде. Третий аргумент `scheduleInPeriod` включает overdue: False — только период, True — также просроченные.

Это ограниченный язык фильтров, а не запуск Python: без импортов, присваиваний, произвольных циклов и доступа к файлам/сети. Для коллекций используйте `any(... for ... in ...)` и `all(... for ... in ...)`. Выражения пишутся в одну строку, отступы — пробелами. Ошибочный фильтр сохранить нельзя.

## Verification

`pnpm test` covers conditional evaluation, shared Schedule scope, generators, regex validation and code/DSL round trips. For the isolated desktop/mobile editor smoke check, start the local web server, then run `node scripts/check-filter-editor.mjs http://127.0.0.1:PORT`. This creates disposable workspaces in a separate headless Chrome profile. Mobile Chromium is not a substitute for real iPhone Safari/PWA testing.
