import { useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent, type MouseEvent } from 'react';
import { canManuallyComplete, type WorkspaceDocument } from '@utm/core';
import { useWorkspaceNow } from '../../hooks/useClock';
import { formatHeaderDate } from '../../utils/dates';
import { CloseIcon, LineIcon, type LineIconName } from '../ui/icons';
import { Button, IconButton } from '../ui/primitives';
import { UserDataText, useTranslation } from '../../i18n-react';
import type { ReminderSnoozeOption } from '../../services/reminderSnooze';
import './app-shell.css';
import { HeaderAgenda } from './HeaderAgenda';

export type AppPage = 'home' | 'calendar' | 'all' | 'automations' | 'organization' | 'settings';
export type AppNotice = { id: string; title: string; body: string; at: string; itemId?: string; reminderIds?: string[] };
type NavItem = [AppPage, LineIconName, string, boolean?];

type Props = {
  page: AppPage; onPage: (page: AppPage) => void; activeDateLabel?: string; workspace?: WorkspaceDocument; openItems: number; children: ReactNode;
  notices: AppNotice[]; popupNoticeIds: string[]; noticeCenterOpen: boolean; mobileNavOpen: boolean;
  onNewView: () => void; onToggleNotices: () => void; onToggleNavigation: () => void; onCloseNavigation: () => void;
  onGoogleCalendarSync?: () => void; googleCalendarSyncing?: boolean; googleCalendarSyncStatus?: string;
  onQuickBackup?: () => void; quickBackupBusy?: boolean; quickBackupPlaintext?: boolean;
  onDismissPopup: (id: string) => void; onDeleteNotice: (id: string) => void; onOpenNotice: (notice: AppNotice) => void; onSnoozeNotice?: (notice: AppNotice, option: ReminderSnoozeOption) => void;
  onCompleteNotice?: (notice: AppNotice) => void;
  onQuickDue?: (target: { itemId: string; seriesId?: string; recurrenceId?: string }) => void;
  onQuickPin?: ((target: { itemId: string; seriesId?: string; recurrenceId?: string }) => void) | undefined;
  onTransfer: () => void; onLock: () => void;
  backupReminder: boolean; onBackupReminder: () => void; onDismissBackupReminder: () => void;
};

function HeaderClock({ workspace, fallback, compact = false }: { workspace?: WorkspaceDocument; fallback?: string; compact?: boolean }) {
  const now = useWorkspaceNow(workspace);
  const format = workspace?.calendarPreferences.headerDateFormat ?? 'ru-adaptive';
  const language = format === 'interface' ? workspace?.calendarPreferences.language ?? 'en' : 'ru';
  const root = useRef<HTMLSpanElement>(null);
  const [level, setLevel] = useState(0);
  const adaptiveVariants = [formatHeaderDate(now, language), new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now), new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now), new Intl.DateTimeFormat(language, { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)];
  const numeric = (year: boolean) => new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', ...(year ? { year: 'numeric' as const } : {}), hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now);
  const shortest = new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const variants = [...(format === 'numeric' ? [numeric(true), numeric(false)] : [...adaptiveVariants.slice(0, -1), format === 'interface' ? adaptiveVariants.at(-1)! : numeric(false)]), shortest];
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const fit = () => { const widths = [...node.querySelectorAll<HTMLElement>('[data-clock-measure]')].map((entry) => entry.getBoundingClientRect().width); const match = widths.findIndex((width) => width <= node.clientWidth); setLevel(match < 0 ? variants.length - 1 : match); };
    const bar = node.closest<HTMLElement>('.topbar');
    const actions = bar?.querySelector<HTMLElement>('.top-actions');
    const resize = () => { if (bar && actions) bar.style.setProperty('--clock-actions-width', `${actions.getBoundingClientRect().width}px`); fit(); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(node); if (actions) observer.observe(actions); return () => observer.disconnect();
  }, [language, format, now.getDate(), compact]);
  return <span ref={root} className="top-summary responsive-clock"><span>{fallback ?? variants[level]}</span><span className="clock-measures" aria-hidden="true">{variants.map((text, index) => <span data-clock-measure key={index}>{text}</span>)}</span></span>;
}

const nav: NavItem[] = [['home', 'home', 'Home'], ['calendar', 'calendar', 'Calendar'], ['all', 'items', 'All items'], ['organization', 'views', 'PARA'], ['settings', 'settings', 'Settings']];

function NoticeCard({ notice, actionLabel, onOpen, onAction, onComplete, onSnooze, language, dismissPopup = false }: {
  notice: AppNotice; actionLabel: string; onOpen: () => void; onAction: () => void; onComplete?: (() => void) | undefined; onSnooze?: ((option: ReminderSnoozeOption) => void) | undefined; language?: string | undefined; dismissPopup?: boolean;
}) {
  const ru = language === 'ru';
  const options: [ReminderSnoozeOption, string][] = [['15m', ru ? '15 мин' : '15 min'], ['1h', ru ? '1 ч' : '1 h'], ['5h', ru ? '5 ч' : '5 h'], ['tomorrow', ru ? 'Завтра, 09:00' : 'Tomorrow, 09:00']];
  return <article className="notice-card"><Button variant="ghost" className="notice-content" onClick={onOpen}><strong><UserDataText>{notice.title}</UserDataText></strong><UserDataText>{notice.body}</UserDataText></Button>{onComplete && <button type="button" className="state-toggle notice-complete" aria-label={ru ? `Выполнить: ${notice.title}` : `Complete: ${notice.title}`} onClick={(event) => { event.stopPropagation(); onComplete(); }} /> }<IconButton size="compact" variant="ghost" className="notice-dismiss" aria-label={actionLabel} onPointerDown={(event) => { if (dismissPopup) event.preventDefault(); event.stopPropagation(); if (dismissPopup) onAction(); }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAction(); }}><CloseIcon /></IconButton>{onSnooze && notice.itemId && notice.reminderIds?.length ? <div className="notice-snooze" aria-label={ru ? 'Отложить напоминание' : 'Snooze reminder'}>{options.map(([option, label]) => <Button key={option} size="compact" variant="ghost" onClick={() => onSnooze(option)}>{label}</Button>)}</div> : null}</article>;
}

export function AppShell(props: Props) {
  const { page, onPage, activeDateLabel, workspace, openItems, children, notices, popupNoticeIds, noticeCenterOpen, mobileNavOpen } = props;
  const t = useTranslation(workspace?.calendarPreferences.language ?? 'en');
  const notificationCount = notices.length + Number(props.backupReminder);
  const quickBackupLabel = props.quickBackupPlaintext ? t('Save plaintext backup') : t('Save encrypted backup');
  const backupNotice: AppNotice = { id: 'backup-reminder', title: t('Backup needs attention'), body: t('Create an encrypted .utmb backup to keep a portable copy of this workspace.'), at: new Date().toISOString() };
  const completeNotice = (notice: AppNotice) => { const item = notice.itemId ? workspace?.items[notice.itemId] : undefined; return item && item.state === 'open' && !item.deletedAt && canManuallyComplete(item) && props.onCompleteNotice ? () => props.onCompleteNotice?.(notice) : undefined; };
  const swipeStart = useRef<{ target: { itemId: string; seriesId?: string; recurrenceId?: string }; x: number; y: number; scrollElement: HTMLElement | null; scrollLeft: number } | null>(null);
  const suppressClickUntil = useRef(0);
  const suppressedItemId = useRef<string | null>(null);
  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    swipeStart.current = null;
    if ((!props.onQuickDue && !props.onQuickPin) || event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, select, textarea, a, [contenteditable="true"], .view-drag-handle, .state-toggle, .ui-icon-button')) return;
    const itemElement = target.closest<HTMLElement>('[data-utm-item-id], [data-utm-due-item-id]');
    if (!itemElement) return;
    const scrollElement = target.closest<HTMLElement>('.renderer-table-wrap, .calendar-strip, .mini-board');
    const seriesId = itemElement.dataset.utmSeriesId ?? itemElement.dataset.utmDueSeriesId;
    const recurrenceId = itemElement.dataset.utmRecurrenceId ?? itemElement.dataset.utmDueRecurrenceId;
    swipeStart.current = { target: { itemId: (itemElement.dataset.utmItemId ?? itemElement.dataset.utmDueItemId)!, ...(seriesId ? { seriesId } : {}), ...(recurrenceId ? { recurrenceId } : {}) }, x: event.touches[0]!.clientX, y: event.touches[0]!.clientY, scrollElement, scrollLeft: scrollElement?.scrollLeft ?? 0 };
  };
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = swipeStart.current; swipeStart.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const distanceX = event.changedTouches[0]!.clientX - start.x;
    const distanceY = event.changedTouches[0]!.clientY - start.y;
    if (Math.abs(distanceX) < 64 || Math.abs(distanceX) < Math.abs(distanceY) * 1.5 || (start.scrollElement && Math.abs(start.scrollElement.scrollLeft - start.scrollLeft) > 4)) return;
    const action = distanceX > 0 ? props.onQuickPin : props.onQuickDue;
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    suppressClickUntil.current = performance.now() + 350;
    suppressedItemId.current = start.target.itemId;
    action(start.target);
  };
  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const start = swipeStart.current;
    if (!start) return;
    if (event.touches.length !== 1) { swipeStart.current = null; return; }
    const dx = Math.abs(event.touches[0]!.clientX - start.x), dy = Math.abs(event.touches[0]!.clientY - start.y);
    if (dy > 12 && dy > dx) swipeStart.current = null;
  };
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-utm-item-id], [data-utm-due-item-id]') : null;
    if (performance.now() < suppressClickUntil.current && card && (card.dataset.utmItemId ?? card.dataset.utmDueItemId) === suppressedItemId.current) { event.preventDefault(); event.stopPropagation(); }
  };
  return <div className={`app-shell page-${page}`}>
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">U</div><span>Universal</span></div><nav>{nav.map(([target, icon, label, beta]) => <Button variant="ghost" key={target} className={page === target ? 'active' : ''} onClick={() => onPage(target)}><LineIcon name={icon}/><span>{t(label)}</span>{beta && <em className="nav-beta" title={t('This area is still being tested and improved.')}>{t('Beta')}</em>}{target === 'all' && openItems > 0 && <b title={t(`${openItems} active ${openItems === 1 ? 'item' : 'items'}`)}>{openItems}</b>}</Button>)}</nav><div className="sidebar-bottom"><Button variant="ghost" onClick={props.onTransfer}><LineIcon name="transfer"/><span>{t('Transfer')}</span></Button><Button variant="ghost" onClick={props.onLock}><LineIcon name="lock"/><span>{t('Lock')}</span></Button></div></aside>
    <main className="content" onKeyDownCapture={event => {
      if (!props.onQuickPin || !event.altKey || event.key.toLowerCase() !== 'p' || !(event.target instanceof HTMLElement)) return;
      if (event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      const node = event.target.closest<HTMLElement>('[data-utm-item-id]');
      if (!node?.dataset.utmItemId) return;
      event.preventDefault(); props.onQuickPin({ itemId: node.dataset.utmItemId, ...(node.dataset.utmSeriesId ? { seriesId: node.dataset.utmSeriesId } : {}), ...(node.dataset.utmRecurrenceId ? { recurrenceId: node.dataset.utmRecurrenceId } : {}) });
    }} onTouchStartCapture={onTouchStart} onTouchMoveCapture={onTouchMove} onTouchEndCapture={onTouchEnd} onTouchCancelCapture={() => { swipeStart.current = null; }} onClickCapture={onClickCapture}>
      <header className="topbar"><div><HeaderClock {...(workspace ? { workspace } : {})} {...(activeDateLabel ? { fallback: activeDateLabel } : {})} compact={page === 'home'} /></div><div className="top-actions">{page === 'home' && <IconButton size="compact" variant="ghost" className="views-add-button" aria-label={t('New view')} title={t('New view')} onClick={props.onNewView}><LineIcon name="plus"/></IconButton>}{(page === 'home' || page === 'calendar') && workspace?.calendarPreferences.googleCalendar && props.onGoogleCalendarSync && <IconButton size="compact" variant="ghost" className={`google-calendar-sync-button${props.googleCalendarSyncing ? ' is-syncing' : ''}`} aria-label={props.googleCalendarSyncStatus || t('Google Calendar sync')} title={props.googleCalendarSyncStatus || t('Google Calendar sync')} disabled={props.googleCalendarSyncing} onClick={props.onGoogleCalendarSync}><LineIcon name="calendarSync"/></IconButton>}{props.onQuickBackup && <IconButton size="compact" variant="ghost" className="quick-backup-button" aria-label={quickBackupLabel} title={quickBackupLabel} disabled={props.quickBackupBusy} onClick={props.onQuickBackup}><LineIcon name="save"/></IconButton>}<IconButton size="compact" variant="ghost" className="notice-button" aria-label={t('Notifications')} aria-expanded={noticeCenterOpen} onClick={props.onToggleNotices} title={t('Notifications')}><LineIcon name="bell"/>{notificationCount > 0 && <b>{notificationCount}</b>}</IconButton><IconButton size="compact" variant="ghost" className="mobile-menu-button" aria-label={t('Open navigation')} aria-expanded={mobileNavOpen} onClick={props.onToggleNavigation}><LineIcon name="menu"/></IconButton></div><HeaderAgenda {...(workspace ? { workspace } : {})} /></header>
      {mobileNavOpen && <>
        <button type="button" className="overlay-dismiss-scrim mobile-nav-scrim" tabIndex={-1} aria-label={t('Close navigation')} onClick={(event) => { event.stopPropagation(); props.onCloseNavigation(); }} />
        <nav className="mobile-nav-menu" aria-label={t('Main navigation')}>{nav.map(([target, icon, label, beta]) => <Button variant="ghost" key={target} className={page === target ? 'active' : ''} onClick={() => { onPage(target); props.onCloseNavigation(); }}><LineIcon name={icon}/><span>{t(label)}</span>{beta && <em className="nav-beta">{t('Beta')}</em>}</Button>)}</nav>
      </>}
      {!noticeCenterOpen && popupNoticeIds.length > 0 && <div className="notice-tray notice-popups" aria-live="polite">{popupNoticeIds.slice(-3).reverse().map((id) => notices.find((notice) => notice.id === id)).filter((notice): notice is AppNotice => Boolean(notice)).map((notice) => <NoticeCard key={notice.id} notice={notice} actionLabel={t('Close notification')} onOpen={() => props.onOpenNotice(notice)} onAction={() => props.onDismissPopup(notice.id)} onComplete={completeNotice(notice)} onSnooze={props.onSnoozeNotice ? (option) => props.onSnoozeNotice?.(notice, option) : undefined} language={workspace?.calendarPreferences.language} dismissPopup />)}</div>}
      {noticeCenterOpen && <><button type="button" className="overlay-dismiss-scrim notification-center-scrim" tabIndex={-1} aria-label={t('Close notification center')} onClick={(event) => { event.stopPropagation(); props.onToggleNotices(); }} /><aside className="notification-center" aria-label={t('Notification center')}><header><h2>{t('Notifications')}</h2><IconButton size="compact" variant="ghost" aria-label={t('Close notification center')} onClick={props.onToggleNotices}><CloseIcon /></IconButton></header><div className="notification-list">{props.backupReminder && <NoticeCard notice={backupNotice} actionLabel={t('Dismiss backup reminder')} onOpen={props.onBackupReminder} onAction={props.onDismissBackupReminder} />}{notices.length ? notices.slice().reverse().map((notice) => <NoticeCard key={notice.id} notice={notice} actionLabel={t('Delete notification')} onOpen={() => props.onOpenNotice(notice)} onAction={() => props.onDeleteNotice(notice.id)} onComplete={completeNotice(notice)} onSnooze={props.onSnoozeNotice ? (option) => props.onSnoozeNotice?.(notice, option) : undefined} language={workspace?.calendarPreferences.language} />) : !props.backupReminder && <p className="empty">{t('No notifications')}</p>}</div></aside></>}
      {children}
    </main>
  </div>;
}
