import type { ReactNode } from 'react';
import type { WorkspaceDocument } from '@utm/core';
import { useWorkspaceNow } from '../../hooks/useClock';
import { formatHeaderDate } from '../../utils/dates';
import { CloseIcon, LineIcon, type LineIconName } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import { UserDataText, useTranslation } from '../../i18n-react';
import './app-shell.css';

export type AppPage = 'home' | 'calendar' | 'all' | 'automations' | 'organization' | 'settings';
export type AppNotice = { id: string; title: string; body: string; at: string; itemId?: string; reminderIds?: string[] };
type NavItem = [AppPage, LineIconName, string, boolean?];

type Props = {
  page: AppPage; onPage: (page: AppPage) => void; activeDateLabel?: string; workspace?: WorkspaceDocument; openItems: number; children: ReactNode;
  notices: AppNotice[]; popupNoticeIds: string[]; noticeCenterOpen: boolean; mobileNavOpen: boolean;
  onNewView: () => void; onToggleNotices: () => void; onToggleNavigation: () => void; onCloseNavigation: () => void;
  onGoogleCalendarSync?: () => void; googleCalendarSyncing?: boolean;
  onDismissPopup: (id: string) => void; onDeleteNotice: (id: string) => void; onOpenNotice: (notice: AppNotice) => void;
  onTransfer: () => void; onLock: () => void;
  backupReminder: boolean; onBackupReminder: () => void; onDismissBackupReminder: () => void;
};

function HeaderClock({ workspace, fallback }: { workspace?: WorkspaceDocument; fallback?: string }) {
  const now = useWorkspaceNow(workspace);
  return <span className="top-summary">{fallback ?? formatHeaderDate(now, workspace?.calendarPreferences.language ?? 'en')}</span>;
}

const nav: NavItem[] = [['home', 'home', 'Home'], ['calendar', 'calendar', 'Calendar'], ['all', 'items', 'All items'], ['organization', 'views', 'PARA'], ['settings', 'settings', 'Settings']];

function NoticeCard({ notice, actionLabel, onOpen, onAction, dismissPopup = false }: {
  notice: AppNotice; actionLabel: string; onOpen: () => void; onAction: () => void; dismissPopup?: boolean;
}) {
  return <article className="notice-card"><Button variant="ghost" className="notice-content" onClick={onOpen}><strong><UserDataText>{notice.title}</UserDataText></strong><UserDataText>{notice.body}</UserDataText></Button><IconButton size="compact" variant="ghost" className="notice-dismiss" aria-label={actionLabel} onPointerDown={(event) => { if (dismissPopup) event.preventDefault(); event.stopPropagation(); if (dismissPopup) onAction(); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAction(); }}><CloseIcon /></IconButton></article>;
}

export function AppShell(props: Props) {
  const { page, onPage, activeDateLabel, workspace, openItems, children, notices, popupNoticeIds, noticeCenterOpen, mobileNavOpen } = props;
  const t = useTranslation(workspace?.calendarPreferences.language ?? 'en');
  const notificationCount = notices.length + Number(props.backupReminder);
  const backupNotice: AppNotice = { id: 'backup-reminder', title: t('Backup needs attention'), body: t('Create an encrypted .utmb backup to keep a portable copy of this workspace.'), at: new Date().toISOString() };
  return <div className={`app-shell page-${page}`}>
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label, beta]) => <Button variant="ghost" key={target} className={page === target ? 'active' : ''} onClick={() => onPage(target)}><LineIcon name={icon}/><span>{t(label)}</span>{beta && <em className="nav-beta" title={t('This area is still being tested and improved.')}>{t('Beta')}</em>}{target === 'all' && openItems > 0 && <b title={t(`${openItems} active ${openItems === 1 ? 'item' : 'items'}`)}>{openItems}</b>}</Button>)}</nav><div className="sidebar-bottom"><Button variant="ghost" onClick={props.onTransfer}><LineIcon name="transfer"/><span>{t('Transfer')}</span></Button><Button variant="ghost" onClick={props.onLock}><LineIcon name="lock"/><span>{t('Lock')}</span></Button></div></aside>
    <main className="content">
      <header className="topbar"><div><HeaderClock {...(workspace ? { workspace } : {})} {...(activeDateLabel ? { fallback: activeDateLabel } : {})} /></div><div className="top-actions">{page === 'home' && <IconButton size="compact" variant="ghost" className="views-add-button" aria-label={t('New view')} title={t('New view')} onClick={props.onNewView}><LineIcon name="plus"/></IconButton>}{page === 'home' && workspace?.calendarPreferences.googleCalendar && props.onGoogleCalendarSync && <IconButton size="compact" variant="ghost" className="google-calendar-sync-button" aria-label={t('Google Calendar sync')} title={t('Google Calendar sync')} disabled={props.googleCalendarSyncing} onClick={props.onGoogleCalendarSync}><LineIcon name="calendarSync"/></IconButton>}<IconButton size="compact" variant="ghost" className="notice-button" aria-label={t('Notifications')} aria-expanded={noticeCenterOpen} onClick={props.onToggleNotices} title={t('Notifications')}><LineIcon name="bell"/>{notificationCount > 0 && <b>{notificationCount}</b>}</IconButton><IconButton size="compact" variant="ghost" className="mobile-menu-button" aria-label={t('Open navigation')} aria-expanded={mobileNavOpen} onClick={props.onToggleNavigation}><LineIcon name="menu"/></IconButton></div></header>
      {mobileNavOpen && <>
        <button type="button" className="overlay-dismiss-scrim mobile-nav-scrim" tabIndex={-1} aria-label={t('Close navigation')} onClick={(event) => { event.stopPropagation(); props.onCloseNavigation(); }} />
        <nav className="mobile-nav-menu" aria-label={t('Main navigation')}>{nav.map(([target, icon, label, beta]) => <Button variant="ghost" key={target} className={page === target ? 'active' : ''} onClick={() => { onPage(target); props.onCloseNavigation(); }}><LineIcon name={icon}/><span>{t(label)}</span>{beta && <em className="nav-beta">{t('Beta')}</em>}</Button>)}</nav>
      </>}
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups" aria-live="polite">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is AppNotice => Boolean(notice)).map((notice) => <NoticeCard key={notice.id} notice={notice} actionLabel={t('Close notification')} onOpen={() => props.onOpenNotice(notice)} onAction={() => props.onDismissPopup(notice.id)} dismissPopup />)}</div>}
      {noticeCenterOpen && <><button type="button" className="overlay-dismiss-scrim notification-center-scrim" tabIndex={-1} aria-label={t('Close notification center')} onClick={(event) => { event.stopPropagation(); props.onToggleNotices(); }} /><aside className="notification-center" aria-label={t('Notification center')}><header><h2>{t('Notifications')}</h2><IconButton size="compact" variant="ghost" aria-label={t('Close notification center')} onClick={props.onToggleNotices}><CloseIcon /></IconButton></header><div className="notification-list">{props.backupReminder && <NoticeCard notice={backupNotice} actionLabel={t('Dismiss backup reminder')} onOpen={props.onBackupReminder} onAction={props.onDismissBackupReminder} />}{notices.length ? notices.slice().reverse().map((notice) => <NoticeCard key={notice.id} notice={notice} actionLabel={t('Delete notification')} onOpen={() => props.onOpenNotice(notice)} onAction={() => props.onDeleteNotice(notice.id)} />) : !props.backupReminder && <p className="empty">{t('No notifications')}</p>}</div></aside></>}
      {children}
    </main>
  </div>;
}
