import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './primitives';

export type CodeLanguage = 'dsl' | 'json';

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Local HTTP addresses and older iOS PWAs can expose the Clipboard API
      // while still rejecting writes. Fall back to a user-gesture copy below.
    }
  }
  const fallback = document.createElement('textarea');
  fallback.value = value;
  fallback.readOnly = true;
  fallback.style.position = 'fixed';
  fallback.style.inset = '0 auto auto -9999px';
  document.body.append(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Clipboard copy is unavailable');
}

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

export function CodeEditor({ value, onChange, language, rows = 8, ariaLabel, id }: {
  value: string; onChange: (value: string) => void; language: CodeLanguage; rows?: number; ariaLabel?: string; id?: string;
}) {
  const backdrop = useRef<HTMLPreElement>(null);
  const feedbackTimer = useRef<number | undefined>(undefined);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => () => window.clearTimeout(feedbackTimer.current), []);
  const copyLabel = 'Copy';
  const copy = async () => {
    try {
      await writeClipboardText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setCopyState('idle'), 1_800);
  };
  return <div className={`syntax-editor syntax-${language}`}>
    <div className="syntax-editor-toolbar">
      <Button className="syntax-editor-copy" size="compact" variant="ghost" aria-label={copyLabel} title={copyLabel} disabled={!value} onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}</Button>
    </div>
    <div className="syntax-editor-body">
      <pre ref={backdrop} aria-hidden>{highlightedCode(value, language)}{value.endsWith('\n') ? ' ' : null}</pre>
      <textarea id={id} aria-label={ariaLabel} spellCheck={false} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} onScroll={(event) => { if (backdrop.current) { backdrop.current.scrollTop = event.currentTarget.scrollTop; backdrop.current.scrollLeft = event.currentTarget.scrollLeft; } }} />
    </div>
  </div>;
}
