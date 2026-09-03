import { useState, type ReactNode } from 'react';
import { Disclosure, Input } from './primitives';

export function SearchableDisclosureList<T>({ uiKey, summary, items, getSearchText, renderItem, searchLabel, searchPlaceholder = 'Search items', emptyText = 'No items yet.', noMatchesText = 'No matching items.', className, description }: {
  uiKey: string;
  summary: ReactNode;
  items: T[];
  getSearchText: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  searchLabel: string;
  searchPlaceholder?: string;
  emptyText?: ReactNode;
  noMatchesText?: ReactNode;
  className?: string;
  description?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase();
  const visible = normalized ? items.filter((item) => getSearchText(item).toLocaleLowerCase().includes(normalized)) : items;
  const protectedSummary = typeof summary === 'string' && items.some((item) => getSearchText(item) === summary)
    ? <span className="ui-user-data-contents" translate="no" data-utm-user-data>{summary}</span>
    : summary;
  const protectedItem = (item: T, index: number) => {
    const builtinInterfaceOption = typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string' && item.id.startsWith('builtin:');
    const rendered = renderItem(item);
    return builtinInterfaceOption ? rendered : <span className="ui-user-data-contents" translate="no" data-utm-user-data key={`${getSearchText(item)}:${index}`}>{rendered}</span>;
  };
  return <Disclosure uiKey={uiKey} persist={false} className={['ui-searchable-disclosure', className].filter(Boolean).join(' ')} summary={protectedSummary}>
    <div className="ui-searchable-disclosure-body">
      {description}
      <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchLabel} />
      <div className="ui-searchable-disclosure-list">{visible.length ? visible.map(protectedItem) : <small className="ui-searchable-disclosure-empty">{items.length ? noMatchesText : emptyText}</small>}</div>
    </div>
  </Disclosure>;
}
