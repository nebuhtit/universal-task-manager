/** Coalesce native backup attempts without a diagnostics-driven retry loop. */
export class NativeBackupGate {
  private attempted: string | null = null;
  private inFlight = false;
  private retryAfter = 0;

  canStart(signature: string, now = Date.now()): boolean {
    return !this.inFlight && this.attempted !== signature && now >= this.retryAfter;
  }

  start(signature: string, now = Date.now()): boolean {
    if (!this.canStart(signature, now)) return false;
    this.attempted = signature;
    this.inFlight = true;
    return true;
  }

  finish(failed: boolean, now = Date.now()): void {
    this.inFlight = false;
    if (failed) this.retryAfter = now + 5 * 60_000;
  }
}
