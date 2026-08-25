import type { ReactNode } from 'react';
import { CloseIcon, LineIcon, type LineIconName } from '../ui/icons';

export type AppPage = 'home' | 'calendar' | 'all' | 'automations' | 'settings';
export type AppNotice = { id: string; title: string; body: string; at: string; itemId?: string; reminderIds?: string[] };
type NavItem = [AppPage, LineIconName, string, boolean?];

type Props = {
  page: AppPage; onPage: (page: AppPage) => void; activeDateLabel: string; openItems: number; children: ReactNode;
  notices: AppNotice[]; popupNoticeIds: string[]; noticeCenterOpen: boolean; mobileNavOpen: boolean;
  onNewView: () => void; onToggleNotices: () => void; onToggleNavigation: () => void; onCloseNavigation: () => void;
  onDismissPopup: (id: string) => void; onDeleteNotice: (id: string) => void; onOpenNotice: (notice: AppNotice) => void;
  onTransfer: () => void; onLock: () => void;
};

const nav: NavItem[] = [['home', 'home', 'Home'], ['all', 'items', 'All items', true], ['settings', 'settings', 'Settings']];

export function AppShell(props: Props) {
  const { page, onPage, activeDateLabel, openItems, children, notices, popupNoticeIds, noticeCenterOpen, mobileNavOpen } = props;
  return <div className={`app-shell page-${page}`}>
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label, beta]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => onPage(target)}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta" title="This area is still being tested and improved.">Beta</em>}{target === 'all' && <b title={`${openItems} active ${openItems === 1 ? 'item' : 'items'}`}>{openItems}</b>}</button>)}</nav><div className="sidebar-bottom"><button onClick={props.onTransfer}><LineIcon name="transfer"/><span>Transfer</span></button><button onClick={props.onLock}><LineIcon name="lock"/><span>Lock</span></button></div></aside>
    <main className="content">
      <header className="topbar"><div><span className="top-summary">{activeDateLabel}</span><span className="sync-state"><i /> Encrypted locally</span></div><div className="top-actions">{page === 'home' && <button className="views-add-button" aria-label="New view" title="New view" onClick={props.onNewView}><LineIcon name="plus"/></button>}<button className="notice-button" aria-label="Notifications" aria-expanded={noticeCenterOpen} onClick={props.onToggleNotices} title="Notifications"><LineIcon name="bell"/>{notices.length > 0 && <b>{notices.length}</b>}</button><button className="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={props.onToggleNavigation}><LineIcon name="menu"/></button></div></header>
      {mobileNavOpen && <nav className="mobile-nav-menu" aria-label="Main navigation">{nav.map(([target, icon, label, beta]) => <button key={target} className={page === target ? 'active' : ''} onClick={() => { onPage(target); props.onCloseNavigation(); }}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta">Beta</em>}</button>)}</nav>}
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups" aria-live="polite">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is AppNotice => Boolean(notice)).map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => props.onOpenNotice(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button type="button" className="notice-dismiss" aria-label="Close notification" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); props.onDismissPopup(notice.id); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); props.onDismissPopup(notice.id); }}><CloseIcon /></button></article>)}</div>}
      {noticeCenterOpen && <aside className="notification-center" aria-label="Notification center"><header><h2>Notifications</h2><button type="button" className="icon-button" aria-label="Close notification center" onClick={props.onToggleNotices}><CloseIcon /></button></header><div className="notification-list">{notices.length ? notices.slice().reverse().map((notice) => <article className="notice-card" key={notice.id}><button className="notice-content" onClick={() => props.onOpenNotice(notice)}><strong>{notice.title}</strong><span>{notice.body}</span></button><button type="button" className="notice-dismiss" aria-label="Delete notification" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); props.onDeleteNotice(notice.id); }}><CloseIcon /></button></article>) : <p className="empty">No notifications</p>}</div></aside>}
      {children}
    </main>
  </div>;
}
