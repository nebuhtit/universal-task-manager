import type { ReactNode } from 'react';
import type { UniversalItem } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';

export function ItemStateMarker({ item, googleLabel, noteLabel, onOpen, children }: { item: UniversalItem; googleLabel: string; noteLabel: string; onOpen: () => void; children: ReactNode }) {
  if (item.external?.provider === 'google_calendar') {
    return <button type="button" className="external-calendar-state-marker" aria-label={googleLabel} title={googleLabel} onClick={(event) => { event.stopPropagation(); onOpen(); }}><LineIcon name="calendar" /></button>;
  }
  if (item.isNote) {
    return <button type="button" className="note-state-marker" aria-label={`${noteLabel}: ${item.title}`} title={noteLabel} onClick={(event) => { event.stopPropagation(); onOpen(); }}><LineIcon name="note" /></button>;
  }
  if (item.schedule?.allDay === true) return <span className="item-state-placeholder" aria-hidden />;
  return children;
}
