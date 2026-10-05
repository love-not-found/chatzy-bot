/** A continuous outage gets a quiet recovery window and a bounded retry budget. */
export class RecoveryWindow {
  private since: number | null = null;
  private nextAt = 0;
  attempts = 0;

  constructor(private readonly timeoutMs: number, private readonly maxRetries: number) {}

  reset(): void {
    this.since = null;
    this.nextAt = 0;
    this.attempts = 0;
  }

  start(now: number): void {
    if (this.since !== null) return;
    this.since = now;
    // Allow Chatzy to reconnect itself before reloading the page.
    this.nextAt = now + Math.min(12_000, this.timeoutMs / 10);
  }

  takeRetry(now: number): boolean {
    if (this.since === null || now < this.nextAt || this.attempts >= this.maxRetries) return false;
    this.attempts++;
    this.nextAt = now + this.timeoutMs / Math.max(1, this.maxRetries);
    return true;
  }

  failed(now: number): boolean {
    return this.timedOut(now) && this.attempts >= this.maxRetries;
  }

  timedOut(now: number): boolean {
    return this.since !== null && now - this.since >= this.timeoutMs;
  }
}
