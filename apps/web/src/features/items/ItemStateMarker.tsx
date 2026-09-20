import type { ReactNode } from 'react';
import { isCalendarItem, type UniversalItem } from '@utm/core';
import { LineIcon } from '../../components/ui/icons';

export function ItemStateMarker({ item, googleLabel, noteLabel, onOpen, children }: { item: UniversalItem; googleLabel: string; noteLabel: string; onOpen: () => void; children: ReactNode }) {
  if (isCalendarItem(item)) {
    const label = item.external ? (item.external.readOnly ? googleLabel : 'UTM + Google Calendar') : item.title;
    return <button type="button" className="external-calendar-state-marker" aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onOpen(); }}><LineIcon name="calendar" /></button>;
  }
  if (item.isNote) {
    return <button type="button" className="note-state-marker" aria-label={`${noteLabel}: ${item.title}`} title={noteLabel} onClick={(event) => { event.stopPropagation(); onOpen(); }}><LineIcon name="note" /></button>;
  }
  if (item.schedule?.allDay === true) return <span className="item-state-placeholder" aria-hidden />;
  return children;
}
