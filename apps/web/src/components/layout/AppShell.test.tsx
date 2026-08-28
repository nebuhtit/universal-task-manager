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
      onNewView={noop} onToggleNotices={noop} onToggleNavigation={noop} onCloseNavigation={noop}
      onDismissPopup={noop} onDeleteNotice={noop} onOpenNotice={noop} onTransfer={noop} onLock={noop}
    ><p>Content</p></AppShell>);

    expect(markup).toContain('aria-label="New view"');
    expect(markup).toContain('aria-label="Notifications"');
    expect(markup).toContain('aria-label="Open navigation"');
    expect(markup).toContain('aria-label="Close notification"');
    expect(markup).not.toContain('role="button"');
  });

  it('announces backup reminders and ordinary toasts separately', () => {
    const markup = renderToStaticMarkup(<ShellNotices backupReminder toast="Saved" onBackup={noop} onDismissBackup={noop} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Dismiss backup reminder"');
    expect(markup).toContain('role="status"');
  });

  it('renders undo actions with their remaining seconds', () => {
    const markup = renderToStaticMarkup(<ShellNotices backupReminder={false} toast="" undoNotices={[{ id: 'undo-1', label: 'Item completed', secondsLeft: 4 }]} onUndo={noop} onBackup={noop} onDismissBackup={noop} />);
    expect(markup).toContain('Item completed');
    expect(markup).toContain('4 seconds remaining');
    expect(markup).toContain('Undo');
  });
});
