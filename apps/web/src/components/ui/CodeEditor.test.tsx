import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeEditor } from './CodeEditor';

describe('CodeEditor', () => {
  it('preserves Python source including comments, quoted punctuation and unsupported characters', () => {
    const source = "return (\n    'тест # (' == 'тест # (' # explanation\n    and True\n) @";
    const markup = renderToStaticMarkup(<CodeEditor language="python" value={source} readOnly />);
    expect(markup).toContain('syntax-keyword');
    expect(markup).toContain('syntax-comment');
    expect(markup).toContain('syntax-string');
    expect(markup).toContain('@');
    expect(markup).not.toContain('<textarea');
    expect(markup).toContain('aria-label="Copy"');
  });
  it('offers the same native copy control for JSON and DSL source', () => {
    const markup = renderToStaticMarkup(<CodeEditor id="source" language="json" ariaLabel="Item JSON" value={'{"title":"Test"}'} onChange={() => undefined} />);

    expect(markup).toContain('class="syntax-editor-toolbar"');
    expect(markup).toContain('aria-label="Copy"');
    expect(markup).toContain('title="Copy"');
    expect(markup).toContain('id="source"');
    expect(markup).toContain('aria-label="Item JSON"');
    expect(markup.indexOf('syntax-editor-toolbar')).toBeLessThan(markup.indexOf('<textarea'));
  });

  it('disables copying when the source is empty', () => {
    const markup = renderToStaticMarkup(<CodeEditor language="dsl" value="" onChange={() => undefined} />);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Copy<\/button>/);
  });
});
