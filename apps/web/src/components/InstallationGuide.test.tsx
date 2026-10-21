import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstallationGuide } from './InstallationGuide';

describe('shared installation instructions', () => {
  it('renders English prose without Russian leakage', () => {
    const html = renderToStaticMarkup(<InstallationGuide language="en" />);
    expect(html).not.toMatch(/[А-Яа-яЁё]/);
    for (const phrase of ['Personal Team', 'Automatically manage signing', 'Developer Mode', 'VPN &amp; Device Management', '7 days', 'AlarmKit', 'AgendaWidget', 'App Group', 'pnpm install', 'Add to Home Screen', '.utmb']) expect(html).toContain(phrase);
    expect(html).toContain('translate="no"');
  });
  it('provides the same complete workflow in Russian, with literal Xcode labels', () => {
    const html = renderToStaticMarkup(<InstallationGuide language="ru" />);
    for (const phrase of ['Установка Universal', 'Режим разработчика', 'Доверять этому компьютеру', 'VPN и управление устройством', '7 дней', 'Personal Team', 'AgendaWidget', 'AlarmKit', 'pnpm install', 'На экран Домой', '.utmb']) expect(html).toContain(phrase);
    expect(html).not.toContain('This installs your own');
    expect(html).toContain('lang="ru"');
  });
});
