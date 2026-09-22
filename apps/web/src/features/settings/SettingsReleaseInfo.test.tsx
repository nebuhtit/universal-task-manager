import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsReleaseInfo } from './SettingsReleaseInfo';

describe('settings save status', () => {
  it('keeps neutral persistence feedback beside the release identity', () => {
    const loaded = renderToStaticMarkup(<SettingsReleaseInfo saveStatus="loaded" />);
    expect(loaded).toContain('settings-release-info-top');
    expect(loaded).toContain('Загружена последняя локальная версия.');
    expect(renderToStaticMarkup(<SettingsReleaseInfo saveStatus="saved" />)).toContain('Сохранено на этом устройстве.');
    expect(renderToStaticMarkup(<SettingsReleaseInfo />)).not.toContain('settings-save-status');
  });
});
