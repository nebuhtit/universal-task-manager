import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WarningNotice } from './WarningNotice';

it('renders an independently dismissible, non-modal warning with its repair action', () => {
  const html = renderToStaticMarkup(<WarningNotice message="Block 1: invalid end" language="ru"><button>Repair</button></WarningNotice>);
  expect(html).toContain('role="alert"');
  expect(html).toContain('Закрыть предупреждение');
  expect(html).toContain('Repair');
  expect(html).not.toContain('role="dialog"');
});
