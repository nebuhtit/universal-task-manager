import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SearchableDisclosureList } from './SearchableDisclosureList';
import { Button } from './primitives';

describe('SearchableDisclosureList localization boundaries', () => {
  it('protects workspace-owned summaries and options from DOM translation', () => {
    const markup = renderToStaticMarkup(<SearchableDisclosureList
      uiKey="test:user-data"
      summary="Home"
      items={['Home', 'Calendar']}
      getSearchText={(item) => item}
      searchLabel="Search Areas"
      renderItem={(item) => <Button key={item}>{item}</Button>}
    />);

    expect(markup).toContain('data-utm-user-data="true">Home</span>');
    expect(markup).toContain('data-utm-user-data="true"><button');
    expect(markup).toContain('>Calendar</button>');
  });
});
