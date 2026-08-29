import type { ReactNode } from 'react';

export function Icon({ children }: { children: ReactNode }) { return <span className="icon" aria-hidden>{children}</span>; }

export function CloseIcon() { return <svg className="close-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M4 4l12 12M16 4 4 16" /></svg>; }

export type LineIconName = 'home' | 'calendar' | 'items' | 'views' | 'rules' | 'settings' | 'lock' | 'bell' | 'transfer' | 'menu' | 'plus' | 'chevronDown';

export function LineIcon({ name }: { name: LineIconName }) {
  const paths: Record<LineIconName, ReactNode> = {
    home: <path d="M10.92 4.84a1.25 1.25 0 0 1 2.16 0l7.17 12.46A1.8 1.8 0 0 1 18.69 20H5.31a1.8 1.8 0 0 1-1.56-2.7l7.17-12.46Z"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>,
    items: <><path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1 1 2-2M3 12h3M3 18h3"/></>,
    views: <><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="8" height="6" rx="1.5"/><rect x="15" y="14" width="6" height="6" rx="1.5"/></>,
    rules: <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    transfer: <><path d="M7 7h11l-3-3M17 17H6l3 3"/><path d="m18 7-3 3M6 17l3-3"/></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    plus: <path d="M12 4v16M4 12h16"/>,
    chevronDown: <path d="m6 9 6 6 6-6"/>,
  };
  return <svg className="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{paths[name]}</svg>;
}
