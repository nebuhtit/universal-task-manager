import type { UniversalItem, WorkspaceDocument } from '@utm/core';
import { useMemo } from 'react';
import { UserDataText } from '../../../../i18n-react';
import { incomingItemRelations, itemReferenceDetail, itemSeriesBranches } from '../../itemIdentity';
import './item-relations.css';

export function IncomingRelations({ item, workspace }: { item: UniversalItem; workspace: WorkspaceDocument }) {
  const incoming = useMemo(() => incomingItemRelations(workspace, item), [workspace, item]);
  const branches = useMemo(() => itemSeriesBranches(workspace, item), [workspace, item]);
  const ru = workspace.calendarPreferences.language === 'ru';
  return <>
    {branches.length > 1 && <div className="relation-series">
      <p className="schedule-explainer">{ru ? 'Это ветки одной повторяющейся серии. Общие связи задач учитываются во всех её продолжениях; прежние даты сохраняются в истории.' : 'These are branches of one recurring series. Shared task relationships follow its continuations; past dates remain in history.'}</p>
      <details><summary>{ru ? 'Ветки этой серии' : 'Branches of this series'} · {branches.length}</summary><div className="relation-cards">{branches.map(branch => <div className="relation-card" key={branch.id}><strong><UserDataText>{branch.title}</UserDataText></strong><span>{branch.id === item.id ? (ru ? 'Эта ветка' : 'This branch') : (ru ? 'Другая ветка серии' : 'Another branch')}</span><small><UserDataText>{itemReferenceDetail(workspace, branch)}</UserDataText></small></div>)}</div></details>
    </div>}
    {incoming.length > 0 && <section className="incoming-relations" aria-label={ru ? 'Входящие связи' : 'Incoming relationships'}>
      <p>{ru ? 'Входящие связи' : 'Incoming relationships'} · {incoming.length}</p>
      <div className="relation-cards">{incoming.map(({ source, relation, inherited }) => <div className="relation-card" key={`${source.id}:${relation.id}`}>
        <strong><UserDataText>{source.title || (ru ? 'Без названия' : 'Untitled item')}</UserDataText></strong>
        <span>{relation.type === 'scheduled_within' ? (ru ? 'Выполняется внутри этого блока' : 'Scheduled within this block')
          : relation.type === 'blocks' ? (ru ? 'Блокирует этот элемент' : 'Blocks this item')
          : relation.type === 'blocked_by' ? (ru ? 'Зависит от этого элемента' : 'Blocked by this item')
          : relation.type === 'duplicate' ? (ru ? 'Дубликат этого элемента' : 'Duplicate of this item')
          : relation.type === 'custom' && relation.label ? <UserDataText>{relation.label}</UserDataText>
          : (ru ? 'Связан с этим элементом' : 'Related to this item')}</span>
        <small><UserDataText>{itemReferenceDetail(workspace, source)}</UserDataText></small>
        {inherited && <small>{ru ? 'Через связь с другой веткой этой серии' : 'Through a link to another branch of this series'} · ID {relation.targetId.slice(-8)}</small>}
      </div>)}</div>
    </section>}
  </>;
}
