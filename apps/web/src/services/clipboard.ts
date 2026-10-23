export async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Local HTTP addresses and older iOS PWAs can expose the Clipboard API
      // while still rejecting writes. Fall back to a user-gesture copy below.
    }
  }
  const fallback = document.createElement('textarea');
  fallback.value = value;
  fallback.readOnly = true;
  fallback.style.position = 'fixed';
  fallback.style.inset = '0 auto auto -9999px';
  (document.activeElement?.closest('[role="dialog"]') ?? document.body).append(fallback);
  fallback.select();
  const copied = document.execCommand('copy');
  fallback.remove();
  if (!copied) throw new Error('Clipboard copy is unavailable');
}
