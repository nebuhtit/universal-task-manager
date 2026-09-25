import { UserDataText } from '../../i18n-react';
import { TRAVEL_BACK_TO, TRAVEL_ROAD, TRAVEL_TO } from './headerAgendaModel';

const markers = [TRAVEL_TO, TRAVEL_ROAD, TRAVEL_BACK_TO] as const;
const markerPattern = /\[\[travel-(?:to|road|back-to)\]\] /g;

/** Exact Lucide arrow-right-to-line and road paths, rendered at text size. */
function TravelIcon({ name }: { name: 'arrow' | 'road' }) {
  return <svg className="header-agenda-departure-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'arrow' ? <><path d="M17 12H3" /><path d="m11 18 6-6-6-6" /><path d="M21 5v14" /></> : <><path d="M12 17v4" /><path d="M12 5V3" /><path d="M12 9v3" /><path d="M2.077 18.449A2 2 0 0 0 4 21h16a2 2 0 0 0 1.924-2.55l-4-14A2 2 0 0 0 16 3H8a2 2 0 0 0-1.924 1.45z" /></>}
  </svg>;
}

export function agendaPlainText(text: string, ru = false): string {
  return text.replaceAll(TRAVEL_TO, ru ? 'До выезда · ' : 'Until departure · ')
    .replaceAll(TRAVEL_ROAD, ru ? 'В пути · ' : 'Travel · ')
    .replaceAll(TRAVEL_BACK_TO, ru ? 'До обратной дороги · ' : 'Until return travel · ');
}

export function AgendaTitle({ text, ru = false }: { text: string; ru?: boolean }) {
  if (!markers.some(marker => text.includes(marker))) return <UserDataText>{text}</UserDataText>;
  const chunks = text.split(markerPattern);
  const found = [...text.matchAll(markerPattern)].map(match => match[0]);
  return <span aria-label={agendaPlainText(text, ru)}>{chunks.map((chunk, index) => <span key={index}>
    {index > 0 && <>{found[index - 1] !== TRAVEL_ROAD && <TravelIcon name="arrow" />}{found[index - 1] !== TRAVEL_BACK_TO && <TravelIcon name="road" />}{' '}</>}
    <UserDataText>{chunk}</UserDataText>
  </span>)}</span>;
}
