import { UserDataText } from '../../i18n-react';

/** The shared projection keeps its compact marker; only presentation uses icons. */
export function AgendaTitle({ text, ru }: { text: string; ru?: boolean }) {
  if (!text.startsWith('⇥ ')) return <UserDataText>{text}</UserDataText>;
  const title = text.slice(2);
  return <span aria-label={`${ru ? 'Выезд' : 'Departure'} · ${title}`}>
    <svg className="header-agenda-departure-icon" viewBox="0 3 40 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 17H2v-7h3l3-5h7l3 5 5 2v5h-3M8 17h8M5 10h13M11 5v5" />
      <circle cx="6" cy="17" r="2" /><circle cx="18" cy="17" r="2" />
      <path d="M28 12h10m-4-4 4 4-4 4" />
    </svg>{' '}<UserDataText>{title}</UserDataText>
  </span>;
}
