import { itemDeletionTime, seriesReferenceAncestors, seriesReferenceOwner, type UniversalItem, type WorkspaceDocument, type ItemRelation } from '@utm/core';
import { formatViewDate } from '../../utils/dates';

export function itemFamilyId(workspace: WorkspaceDocument, item: UniversalItem): string {
  const ids = seriesReferenceAncestors(workspace, item.role === 'series_template' ? item.id : item.occurrence?.seriesId ?? item.id);
  return ids.at(-1)!;
}

export function itemReferenceDetail(workspace: WorkspaceDocument, item: UniversalItem): string {
  const ru = workspace.calendarPreferences.language === 'ru';
  const calendar = item.external?.calendarId;
  const calendarName = calendar && (workspace.calendarPreferences.googleCalendar?.calendars.find(entry => entry.id === calendar)?.name ?? 'Google Calendar');
  const split = item.recurrenceOverride?.kind === 'future_split' ? item.recurrenceOverride : undefined;
  const date = split?.recurrenceId ?? item.schedule?.startAt ?? item.schedule?.dueAt;
  const parts = [calendarName, ...item.areas, ...item.projects,
    split ? `${ru ? 'Продолжение с' : 'Continuation from'} ${formatViewDate(split.recurrenceId, false, workspace.calendarPreferences.language)}`
      : date ? `${item.role === 'series_template' ? (ru ? 'Исходная серия · ' : 'Source series · ') : ''}${formatViewDate(date, false, workspace.calendarPreferences.language)}` : undefined,
    `ID ${item.id.slice(-8)}`];
  return [...new Set(parts.filter((value): value is string => Boolean(value)))].join(' · ');
}

const titleKey = (title: string) => title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function sameNameIndependentItems(workspace: WorkspaceDocument, item: UniversalItem): UniversalItem[] {
  if (!titleKey(item.title)) return [];
  const family = itemFamilyId(workspace, item), seen = new Set<string>();
  return Object.values(workspace.items).filter(candidate => {
    if (itemDeletionTime(workspace, candidate) || titleKey(candidate.title) !== titleKey(item.title)) return false;
    const id = itemFamilyId(workspace, candidate);
    if (id === family || seen.has(id)) return false;
    seen.add(id); return true;
  });
}

export function itemSeriesBranches(workspace: WorkspaceDocument, item: UniversalItem): UniversalItem[] {
  const family = itemFamilyId(workspace, item);
  return Object.values(workspace.items).filter(candidate => candidate.role === 'series_template'
    && !itemDeletionTime(workspace, candidate) && itemFamilyId(workspace, candidate) === family)
    .sort((a, b) => (a.recurrenceOverride?.recurrenceId ?? '').localeCompare(b.recurrenceOverride?.recurrenceId ?? '') || a.id.localeCompare(b.id));
}

export function incomingItemRelations(workspace: WorkspaceDocument, item: UniversalItem): Array<{ source: UniversalItem; relation: ItemRelation; inherited: boolean }> {
  const family = itemFamilyId(workspace, item);
  return Object.values(workspace.items).flatMap(source => {
    if (source.id === item.id || itemDeletionTime(workspace, source)) return [];
    const seen = new Set<string>();
    return [...source.relations].sort((a, b) => Number(b.targetId === item.id) - Number(a.targetId === item.id)).flatMap(relation => {
      if (relation.type === 'parent') return []; // Already shown by the subtask controls.
      const target = workspace.items[relation.targetId];
      const direct = relation.targetId === item.id;
      const inherited = relation.type === 'scheduled_within' && !direct
        && (target ? itemFamilyId(workspace, target) : seriesReferenceAncestors(workspace, seriesReferenceOwner(workspace, relation.targetId)).at(-1)) === family;
      if (!direct && !inherited) return [];
      // Default materialized cycles repeat the source relationship; show it once.
      const parent = source.occurrence && workspace.items[source.occurrence.seriesId];
      if (parent?.relations.some(entry => entry.type === relation.type && entry.targetId === relation.targetId)) return [];
      if (seen.has(relation.type)) return [];
      seen.add(relation.type);
      return [{ source, relation, inherited }];
    });
  });
}
