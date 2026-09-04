import type { ReactNode } from 'react';
import type { UniversalItem } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';

export function ItemStateMarker({ item, googleLabel, onOpen, children }: { item: UniversalItem; googleLabel: string; onOpen: () => void; children: ReactNode }) {
  if (item.external?.provider === 'google_calendar') {
    return <button type="button" className="external-calendar-state-marker" aria-label={googleLabel} title={googleLabel} onClick={(event) => { event.stopPropagation(); onOpen(); }}><LineIcon name="calendar" /></button>;
  }
  if (item.schedule?.allDay === true) return <span className="item-state-placeholder" aria-hidden />;
  return children;
}
