import { APP_NAME, APP_VERSION } from '@utm/core';
import { useDisplayedBuild } from '../../hooks/useDisplayedBuild';

export function SettingsReleaseInfo() {
  const displayedBuild = useDisplayedBuild();
  return <p className="settings-release-info settings-release-info-top">{APP_NAME} · v{APP_VERSION} · build {displayedBuild.commit}{displayedBuild.dirty ? ' · local changes' : ''}</p>;
}

