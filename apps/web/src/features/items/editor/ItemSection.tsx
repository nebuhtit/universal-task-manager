import type { ReactNode } from 'react';
import { PersistedDetails } from '../../../components/ui/PersistedDetails';
import { FieldIconLabel } from '../FieldIcon';

export function ItemSection({ sectionKey, title, iconPath, filledMark, compact = false, children }: {
  sectionKey: string;
  title: ReactNode;
  iconPath?: string;
  filledMark?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return <PersistedDetails
    uiKey={`item-editor:${sectionKey}`}
    defaultOpen={false}
    className={compact ? 'item-section compact-property' : 'item-section'}
  >
    <summary>{iconPath ? <FieldIconLabel path={iconPath} label={title} /> : title} {filledMark}</summary>
    <div className="details-body">{children}</div>
  </PersistedDetails>;
}
