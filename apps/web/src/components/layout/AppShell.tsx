import type { ReactNode } from 'react';
import { CloseIcon, LineIcon, type LineIconName } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import './app-shell.css';

export type AppPage = 'home' | 'calendar' | 'all' | 'automations' | 'organization' | 'settings';
export type AppNotice = { id: string; title: string; body: string; at: string; itemId?: string; reminderIds?: string[] };
type NavItem = [AppPage, LineIconName, string, boolean?];

type Props = {
  page: AppPage; onPage: (page: AppPage) => void; activeDateLabel: string; openItems: number; children: ReactNode;
  notices: AppNotice[]; popupNoticeIds: string[]; noticeCenterOpen: boolean; mobileNavOpen: boolean;
  onNewView: () => void; onToggleNotices: () => void; onToggleNavigation: () => void; onCloseNavigation: () => void;
  onDismissPopup: (id: string) => void; onDeleteNotice: (id: string) => void; onOpenNotice: (notice: AppNotice) => void;
  onTransfer: () => void; onLock: () => void;
  backupReminder: boolean; onBackupReminder: () => void; onDismissBackupReminder: () => void;
};

const nav: NavItem[] = [['home', 'home', 'Home'], ['calendar', 'calendar', 'Calendar'], ['all', 'items', 'All items'], ['organization', 'views', 'PARA'], ['settings', 'settings', 'Settings']];

function NoticeCard({ notice, actionLabel, onOpen, onAction, dismissPopup = false }: {
  notice: AppNotice; actionLabel: string; onOpen: () => void; onAction: () => void; dismissPopup?: boolean;
}) {
  return <article className="notice-card"><Button variant="ghost" className="notice-content" onClick={onOpen}><strong>{notice.title}</strong><span>{notice.body}</span></Button><IconButton size="compact" variant="ghost" className="notice-dismiss" aria-label={actionLabel} onPointerDown={(event) => { if (dismissPopup) event.preventDefault(); event.stopPropagation(); if (dismissPopup) onAction(); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAction(); }}><CloseIcon /></IconButton></article>;
}

export function AppShell(props: Props) {
  const { page, onPage, activeDateLabel, openItems, children, notices, popupNoticeIds, noticeCenterOpen, mobileNavOpen } = props;
  const notificationCount = notices.length + Number(props.backupReminder);
  const backupNotice: AppNotice = { id: 'backup-reminder', title: 'Backup needs attention', body: 'Create an encrypted .utmb backup to keep a portable copy of this workspace.', at: new Date().toISOString() };
  return <div className={`app-shell page-${page}`}>
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label, beta]) => <Button variant="ghost" key={target} className={page === target ? 'active' : ''} onClick={() => onPage(target)}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta" title="This area is still being tested and improved.">Beta</em>}{target === 'all' && openItems > 0 && <b title={`${openItems} active ${openItems === 1 ? 'item' : 'items'}`}>{openItems}</b>}</Button>)}</nav><div className="sidebar-bottom"><Button variant="ghost" onClick={props.onTransfer}><LineIcon name="transfer"/><span>Transfer</span></Button><Button variant="ghost" onClick={props.onLock}><LineIcon name="lock"/><span>Lock</span></Button></div></aside>
    <main className="content">
      <header className="topbar"><div><span className="top-summary">{activeDateLabel}</span></div><div className="top-actions">{page === 'home' && <IconButton size="compact" variant="ghost" className="views-add-button" aria-label="New view" title="New view" onClick={props.onNewView}><LineIcon name="plus"/></IconButton>}<IconButton size="compact" variant="ghost" className="notice-button" aria-label="Notifications" aria-expanded={noticeCenterOpen} onClick={props.onToggleNotices} title="Notifications"><LineIcon name="bell"/>{notificationCount > 0 && <b>{notificationCount}</b>}</IconButton><IconButton size="compact" variant="ghost" className="mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={props.onToggleNavigation}><LineIcon name="menu"/></IconButton></div></header>
      {mobileNavOpen && <nav className="mobile-nav-menu" aria-label="Main navigation">{nav.map(([target, icon, label, beta]) => <Button variant="ghost" key={target} className={page === target ? 'active' : ''} onClick={() => { onPage(target); props.onCloseNavigation(); }}><LineIcon name={icon}/><span>{label}</span>{beta && <em className="nav-beta">Beta</em>}</Button>)}</nav>}
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups" aria-live="polite">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is AppNotice => Boolean(notice)).map((notice) => <NoticeCard key={notice.id} notice={notice} actionLabel="Close notification" onOpen={() => props.onOpenNotice(notice)} onAction={() => props.onDismissPopup(notice.id)} dismissPopup />)}</div>}
      {noticeCenterOpen && <aside className="notification-center" aria-label="Notification center"><header><h2>Notifications</h2><IconButton size="compact" variant="ghost" aria-label="Close notification center" onClick={props.onToggleNotices}><CloseIcon /></IconButton></header><div className="notification-list">{props.backupReminder && <NoticeCard notice={backupNotice} actionLabel="Dismiss backup reminder" onOpen={props.onBackupReminder} onAction={props.onDismissBackupReminder} />}{notices.length ? notices.slice().reverse().map((notice) => <NoticeCard key={notice.id} notice={notice} actionLabel="Delete notification" onOpen={() => props.onOpenNotice(notice)} onAction={() => props.onDeleteNotice(notice.id)} />) : !props.backupReminder && <p className="empty">No notifications</p>}</div></aside>}
      {children}
    </main>
  </div>;
}
