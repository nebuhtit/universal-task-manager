import type { ReactNode } from 'react';
import { PersistedDetails } from '../../../components/ui/PersistedDetails';

export function ItemSection({ sectionKey, title, filledMark, compact = false, children }: {
  sectionKey: string;
  title: ReactNode;
  filledMark?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}) {
  return <PersistedDetails
    uiKey={`item-editor:${sectionKey}`}
    defaultOpen={false}
    className={compact ? 'item-section compact-property' : 'item-section'}
  >
    <summary>{title} {filledMark}</summary>
    <div className="details-body">{children}</div>
  </PersistedDetails>;
}
