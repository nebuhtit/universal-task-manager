import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell, type AppNotice } from './AppShell';
import { ShellNotices } from './ShellNotices';

const noop = () => undefined;

describe('AppShell', () => {
  it('keeps navigation and notice actions as named native buttons', () => {
    const notice: AppNotice = { id: 'notice-1', title: 'Reminder', body: 'Call', at: '2026-08-26T08:00:00.000Z' };
    const markup = renderToStaticMarkup(<AppShell
      page="home" onPage={noop} activeDateLabel="Wed 26 Aug 26, 11:00:00" openItems={1}
      notices={[notice]} popupNoticeIds={[notice.id]} noticeCenterOpen={false} mobileNavOpen={false}
      backupReminder={false} onBackupReminder={noop} onDismissBackupReminder={noop}
      onNewView={noop} onToggleNotices={noop} onToggleNavigation={noop} onCloseNavigation={noop}
      onDismissPopup={noop} onDeleteNotice={noop} onOpenNotice={noop} onTransfer={noop} onLock={noop}
    ><p>Content</p></AppShell>);

    expect(markup).toContain('aria-label="New view"');
    expect(markup).toContain('aria-label="Notifications"');
    expect(markup).toContain('aria-label="Open navigation"');
    expect(markup).toContain('aria-label="Close notification"');
    expect(markup).not.toContain('role="button"');
  });

  it('keeps backup reminders inside the notification center', () => {
    const markup = renderToStaticMarkup(<AppShell
      page="home" onPage={noop} activeDateLabel="Wed" openItems={0}
      notices={[]} popupNoticeIds={[]} noticeCenterOpen mobileNavOpen={false} backupReminder onBackupReminder={noop} onDismissBackupReminder={noop}
      onNewView={noop} onToggleNotices={noop} onToggleNavigation={noop} onCloseNavigation={noop}
      onDismissPopup={noop} onDeleteNotice={noop} onOpenNotice={noop} onTransfer={noop} onLock={noop}
    ><p>Content</p></AppShell>);
    expect(markup).toContain('Backup needs attention');
    expect(markup).toContain('aria-label="Dismiss backup reminder"');
    expect(markup).not.toContain('>0</b>');
  });

  it('renders ordinary toasts separately', () => {
    const markup = renderToStaticMarkup(<ShellNotices toast="Saved" />);
    expect(markup).toContain('role="status"');
  });

  it('renders undo actions with their remaining seconds', () => {
    const markup = renderToStaticMarkup(<ShellNotices toast="" undoNotices={[{ id: 'undo-1', label: 'Item completed', secondsLeft: 4 }]} onUndo={noop} />);
    expect(markup).toContain('Item completed');
    expect(markup).toContain('4 seconds remaining');
    expect(markup).toContain('Undo');
  });
});
