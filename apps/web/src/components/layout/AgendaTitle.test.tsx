import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgendaTitle } from './AgendaTitle';

it('renders Lucide arrow-right-to-line and road before departure', () => {
  const html = renderToStaticMarkup(<AgendaTitle text="[[travel-to]] Даша" ru />);
  expect(html).toContain('header-agenda-departure-icon');
  expect(html).toContain('До выезда · Даша');
  expect(html).toContain('m11 18 6-6-6-6');
  expect(html).toContain('M12 17v4');
  expect(html).not.toContain('[[travel-to]]');
  expect(renderToStaticMarkup(<AgendaTitle text="Даша" />)).not.toContain('<svg');
});

it('renders road while travelling and an arrow before return travel', () => {
  const html = renderToStaticMarkup(<AgendaTitle text="Work ([[travel-road]] Задача)" ru />);
  expect(html).not.toContain('[[travel-road]]');
  expect(html).toContain('header-agenda-departure-icon');
  expect(html).toContain('Work (В пути · Задача)');
  expect(renderToStaticMarkup(<AgendaTitle text="[[travel-back-to]] Задача" />)).toContain('m11 18 6-6-6-6');
});
