import { APP_NAME, APP_VERSION } from '@utm/core';
import { useDisplayedBuild } from '../../hooks/useDisplayedBuild';

export function SettingsReleaseInfo({ saveStatus }: { saveStatus?: 'loaded' | 'saving' | 'saved' | 'error' }) {
  const displayedBuild = useDisplayedBuild();
  return <p className="settings-release-info settings-release-info-top">{APP_NAME} · v{APP_VERSION} · build {displayedBuild.commit}{displayedBuild.dirty ? ' · local changes' : ''}{saveStatus && <span data-testid="settings-save-status"> · {saveStatus === 'loaded' ? 'Загружена последняя локальная версия.' : saveStatus === 'saved' ? 'Сохранено на этом устройстве.' : saveStatus === 'saving' ? 'Сохранение…' : 'Не сохранено.'}</span>}</p>;
}
