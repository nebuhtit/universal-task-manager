import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgendaTitle } from './AgendaTitle';

it('renders departure as a side-view car with arrow, without changing the title', () => {
  const html = renderToStaticMarkup(<AgendaTitle text="⇥ Даша" ru />);
  expect(html).toContain('header-agenda-departure-icon');
  expect(html).toContain('Выезд · Даша');
  expect(html).not.toContain('⇥');
  expect(renderToStaticMarkup(<AgendaTitle text="Даша" />)).not.toContain('<svg');
});

it('replaces departure markers inside concurrent status parentheses too', () => {
  const html = renderToStaticMarkup(<AgendaTitle text="Work (⇥ Задача)" ru />);
  expect(html).not.toContain('⇥');
  expect(html).toContain('header-agenda-departure-icon');
  expect(html).toContain('Work (Выезд · Задача)');
});
