import { useState } from 'react';
import type { WorkspaceDocument } from '@utm/core';
import { Button, Checkbox, Field, Input } from '../../components/ui/primitives';
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
  const reminderDefaults = workspace.calendarPreferences.liveTextDefaultReminders ?? { enabled: true, minutesBefore: [120, 1440] };
  const [reminderText, setReminderText] = useState(() => reminderDefaults.minutesBefore.join(', '));
  const saveReminderDefaults = (enabled: boolean, text = reminderText) => {
    const minutes = Array.from(new Set(text.split(/[,;\s]+/).map(Number).filter(value => Number.isInteger(value) && value > 0 && value <= 525600))).slice(0, 8);
    commit('Live text default reminders', draft => { draft.calendarPreferences.liveTextDefaultReminders = { enabled, minutesBefore: minutes }; });
  };
  const act = (action: () => void) => { try { action(); setCount(readLiveTextReports(workspace.workspaceId).length); setError(''); } catch (reason) { setError(String(reason)); } };
  return <section className="settings-card"><h2>Live text</h2>
    <Checkbox disabled={saving} checked={workspace.calendarPreferences.liveTextSuggestions !== false} label="Подсказки над строкой ввода" onChange={(event) => { void changeSuggestions(event.target.checked); }} />
    <Checkbox checked={reminderDefaults.enabled} label="Автоматические напоминания для новых событий" onChange={(event) => saveReminderDefaults(event.target.checked)} />
    <Field label="За сколько минут до Event opens"><Input inputMode="numeric" value={reminderText} placeholder="120, 1440" onChange={(event) => setReminderText(event.target.value)} onBlur={() => saveReminderDefaults(reminderDefaults.enabled)} /></Field>
    <p className="hint">Несколько интервалов разделяются запятыми. Настройка применяется только к новым событиям; явные команды «напомнить» всегда сохраняются.</p>
    {(saving || saved) && <p role="status">{saving ? 'Сохранение…' : 'Настройка сохранена'}</p>}
    <p className="hint">Дата, длительность и напоминания распознаются при создании item. Подсказки можно выбирать мышью, касанием или стрелками и Enter.</p>
    <p>Отчёты об ошибках: {count}. Хранятся на этом устройстве без шифрования, содержат только отправленный вами текст и результат разбора. Последние 100 отчётов.</p>
    <div className="live-text-report-actions"><Button onClick={() => act(() => exportLiveTextReports(workspace.workspaceId))}>Скачать логи JSON</Button><Button disabled={!count} onClick={() => act(() => clearLiveTextReports(workspace.workspaceId))}>Очистить логи</Button></div>
    {error && <p role="alert" className="ui-field-error">{error}</p>}
  </section>;
}
