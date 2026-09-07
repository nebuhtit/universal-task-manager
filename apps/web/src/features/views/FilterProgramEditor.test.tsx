import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspace, pythonToFilter } from '@utm/core';
import { FilterProgramEditor } from './FilterProgramEditor';

describe('shared filter editor', () => {
  it('renders grouped rules, branches and collection predicates as native controls', () => {
    const workspace = createWorkspace('Filters');
    const source = pythonToFilter('if state == "done":\n    return True\nelif state == "open":\n    return any(entry == "work" for entry in tags)\nelse:\n    return False');
    const html = renderToStaticMarkup(<FilterProgramEditor workspace={workspace} source={source} onChange={vi.fn()} onValidityChange={vi.fn()} />);
    expect(html).toContain('Code (Python-like)');
    expect(html).toContain('ELIF / ELSE');
    expect(html).toContain('Collection condition');
    expect(html).toContain('<select');
    expect(html).not.toContain('role="dialog"');
  });
  it('uses the workspace language for new editor controls', () => {
    const workspace = createWorkspace('Filters'); workspace.calendarPreferences.language = 'ru';
    const html = renderToStaticMarkup(<FilterProgramEditor workspace={workspace} source='state == "open"' onChange={vi.fn()} onValidityChange={vi.fn()} />);
    expect(html).toContain('Код (как Python)');
    expect(html).toContain('Блоки');
    expect(html).toContain('Свойство');
  });
});
