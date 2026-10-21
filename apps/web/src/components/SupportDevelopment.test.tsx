import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEVELOPMENT_SUPPORT_URL, DonateButton, SupportDevelopment } from './SupportDevelopment';

it.each(['en', 'ru', 'es', 'de', 'fr', 'ko'] as const)('renders localized support copy and a private external link in %s', language => {
  const html = renderToStaticMarkup(<SupportDevelopment language={language} />);
  expect(DEVELOPMENT_SUPPORT_URL).toBe('https://yoomoney.ru/fundraise/1L286389BIR.261021');
  expect(html).toContain(`href="${DEVELOPMENT_SUPPORT_URL}"`);
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).toContain('<span aria-hidden="true">☺️ ↗</span>');
  expect(html).not.toMatch(/<script|<iframe/);
  const expectedHeadings = { en: 'Donate', ru: 'Поддержать разработку', es: 'Donar', de: 'Spenden', fr: 'Faire un don', ko: '후원하기' };
  const expectedButtons = { en: 'Donate via YooMoney', ru: 'Поддержать через ЮMoney', es: 'Donar a través de YooMoney', de: 'Über YooMoney spenden', fr: 'Faire un don via YooMoney', ko: 'YooMoney로 후원' };
  expect(html).toContain(expectedHeadings[language]);
  expect(html).toContain(expectedButtons[language]);
  if (language === 'en') expect(html).not.toMatch(/[А-Яа-яЁё]/);
});

it.each([
  ['en', 'Buy me a coffee'], ['ru', 'Подарить мне кофе'], ['es', 'Invítame a un café'],
  ['de', 'Spendier mir einen Kaffee'], ['fr', 'Offrez-moi un café'], ['ko', '커피 한 잔 사주세요'],
] as const)('localizes the compact coffee button in %s', (language, label) => {
  const html = renderToStaticMarkup(<DonateButton compact language={language} />);
  expect(html).toContain('data-size="compact"');
  expect(html).toContain(label);
  expect(html).toContain('<span aria-hidden="true">☺️</span>');
  expect(html).toContain(`href="${DEVELOPMENT_SUPPORT_URL}"`);
});
