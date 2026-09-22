import { useState } from 'react';
import type { WorkspaceDocument } from '@utm/core';
import { Button, Checkbox } from '../../components/ui/primitives';
import { clearLiveTextReports, exportLiveTextReports, readLiveTextReports } from '../items/liveTextReports';

export function LiveTextSettings({ workspace, commit, onFlush }: { workspace: WorkspaceDocument; commit: (message: string, mutation: (draft: WorkspaceDocument) => void) => void; onFlush: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const changeSuggestions = async (enabled: boolean) => {
    setSaving(true); setSaved(false); setError('');
    try {
      commit('Live text suggestions', (draft) => { draft.calendarPreferences.liveTextSuggestions = enabled; });
      await onFlush(); setSaved(true);
    } catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  };
  const [count, setCount] = useState(() => { try { return readLiveTextReports(workspace.workspaceId).length; } catch { return 0; } });
  const act = (action: () => void) => { try { action(); setCount(readLiveTextReports(workspace.workspaceId).length); setError(''); } catch (reason) { setError(String(reason)); } };
  return <section className="settings-card"><h2>Live text</h2>
    <Checkbox disabled={saving} checked={workspace.calendarPreferences.liveTextSuggestions !== false} label="Подсказки над строкой ввода" onChange={(event) => { void changeSuggestions(event.target.checked); }} />
    {(saving || saved) && <p role="status">{saving ? 'Сохранение…' : 'Настройка сохранена'}</p>}
    <p className="hint">Дата, длительность и напоминания распознаются при создании item. Подсказки можно выбирать мышью, касанием или стрелками и Enter.</p>
    <p>Отчёты об ошибках: {count}. Хранятся на этом устройстве без шифрования, содержат только отправленный вами текст и результат разбора. Последние 100 отчётов.</p>
    <div className="live-text-report-actions"><Button onClick={() => act(() => exportLiveTextReports(workspace.workspaceId))}>Скачать логи JSON</Button><Button disabled={!count} onClick={() => act(() => clearLiveTextReports(workspace.workspaceId))}>Очистить логи</Button></div>
    {error && <p role="alert" className="ui-field-error">{error}</p>}
  </section>;
}
