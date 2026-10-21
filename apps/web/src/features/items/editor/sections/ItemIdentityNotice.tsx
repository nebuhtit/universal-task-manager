import type { UniversalItem, WorkspaceDocument } from '@utm/core';
import { useMemo } from 'react';
import { UserDataText } from '../../../../i18n-react';
import { sameNameIndependentItems, itemReferenceDetail } from '../../itemIdentity';

export function ItemIdentityNotice({ item, workspace }: { item: UniversalItem; workspace: WorkspaceDocument }) {
  const others = useMemo(() => sameNameIndependentItems(workspace, item), [workspace, item]);
  if (!others.length) return null;
  const ru = workspace.calendarPreferences.language === 'ru';
  return <div className="schedule-explainer" role="status">
    <p>{ru ? 'Есть отдельные элементы с таким названием. Название не объединяет их: у каждого свои ID и связи.' : 'Other independent items share this name. Each has its own ID and relationships; a shared name does not merge them.'}</p>
    {others.slice(0, 5).map(other => <p key={other.id}><UserDataText>{other.title}</UserDataText><br /><small><UserDataText>{itemReferenceDetail(workspace, other)}</UserDataText></small></p>)}
    {others.length > 5 && <small>{ru ? 'Всего совпадений' : 'Total matches'}: {others.length}</small>}
  </div>;
}
