import { useRef, type ReactNode } from 'react';

export type CodeLanguage = 'dsl' | 'json';

function highlightedCode(source: string, language: CodeLanguage): ReactNode[] {
  const pattern = language === 'json'
    ? /("(?:\\.|[^"\\])*")(?=\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[{}[\],:]|\s+|[^\s{}[\],:]+/g
    : /("(?:\\.|[^"\\])*")|\b(true|false|null|in)\b|-?\b\d+(?:\.\d+)?\b|&&|\|\||==|!=|>=|<=|[><!+*/%-]|[()[\],.]|\s+|[A-Za-z_][\w.]*/g;
  const tokens = source.match(pattern) ?? [source];
  let cursor = 0;
  return tokens.map((token) => {
    const at = source.indexOf(token, cursor); cursor = at + token.length;
    const rest = source.slice(cursor);
    let kind = 'plain';
    if (/^\s+$/.test(token)) kind = 'space';
    else if (/^"/.test(token)) kind = language === 'json' && /^\s*:/.test(rest) ? 'key' : 'string';
    else if (/^(?:true|false|null|in)$/.test(token)) kind = 'keyword';
    else if (/^-?\d/.test(token)) kind = 'number';
    else if (/^(?:&&|\|\||==|!=|>=|<=|[><!+*/%\-]|[{}[\],:().])$/.test(token)) kind = 'operator';
    else if (language === 'dsl' && /^[A-Za-z_]/.test(token)) kind = rest.trimStart().startsWith('(') ? 'function' : 'identifier';
    return <span className={`syntax-${kind}`} key={`${cursor}-${token}`}>{token}</span>;
  });
}

export function CodeEditor({ value, onChange, language, rows = 8, ariaLabel }: {
  value: string; onChange: (value: string) => void; language: CodeLanguage; rows?: number; ariaLabel?: string;
}) {
  const backdrop = useRef<HTMLPreElement>(null);
  return <div className={`syntax-editor syntax-${language}`}>
    <pre ref={backdrop} aria-hidden>{highlightedCode(value, language)}{value.endsWith('\n') ? ' ' : null}</pre>
    <textarea aria-label={ariaLabel} spellCheck={false} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} onScroll={(event) => { if (backdrop.current) { backdrop.current.scrollTop = event.currentTarget.scrollTop; backdrop.current.scrollLeft = event.currentTarget.scrollLeft; } }} />
  </div>;
}
