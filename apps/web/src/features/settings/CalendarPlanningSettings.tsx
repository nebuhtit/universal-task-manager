import { useState } from 'react';
import type { WorkspaceDocument } from '@utm/core';
import { Checkbox } from '../../components/ui/primitives';
export function CalendarPlanningSettings({ workspace, commit, onFlush }: { workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => boolean | void; onFlush: () => Promise<void> }) {
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const ru = workspace.calendarPreferences.language === 'ru';
  return <section className="settings-card"><h2>{ru ? 'Планирование календаря' : 'Calendar planning'}</h2>
    <Checkbox checked={workspace.calendarPreferences.planning?.enabled !== false} disabled={saving} label={ru ? 'Ручной порядок и временные ярлыки' : 'Manual order and temporary references'} onChange={event => {
      const enabled = event.target.checked; setSaving(true); setError('');
      try { if (commit('Calendar planning switch', draft => { draft.calendarPreferences.planning ??= {}; draft.calendarPreferences.planning.enabled = enabled; }) === false) throw new Error('Could not save calendar preferences'); void onFlush().catch(reason => setError(String(reason))).finally(() => setSaving(false)); }
      catch (reason) { setError(String(reason)); setSaving(false); }
    }} />
    <p className="hint">{ru ? 'Включено по умолчанию. Свайп вправо по карточке или Alt+P — закрепить на сегодня/завтра. Свайп влево по-прежнему меняет Due. Отключение возвращает прежний календарь, не удаляя сохранённый порядок и ссылки.' : 'Enabled by default. Swipe right on a card or press Alt+P to pin for today/tomorrow. Swipe left still changes Due. Disabling restores the previous calendar without deleting saved orders or references.'}</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
