/**
 * Only live Chatzy "X joined the chat" system lines trigger notifications.
 * Visitor-list snapshots update online presence silently; list changes are
 * unreliable evidence of an actual join.
 */
export class JoinDetector {
  private online = new Set<string>();
  private lastNotified = new Map<string, number>();
  private hasBaseline = false;

  constructor(
    private readonly isSelf: (name: string) => boolean,
    private readonly dedupeWindowMs = 90_000,
  ) {}

  /** Reset after reconnects: the next snapshot becomes the new baseline. */
  reset(): void {
    this.online.clear();
    this.hasBaseline = false;
  }

  get onlineUsers(): string[] {
    return [...this.online];
  }

  get ready(): boolean {
    return this.hasBaseline;
  }

  /** Returns true if a notification should be sent for this join line. */
  onJoinLine(name: string, now = Date.now()): boolean {
    this.online.add(name);
    return this.claim(name, now);
  }

  onLeaveLine(name: string): void {
    this.online.delete(name);
  }

  /** Refresh online presence without generating or suppressing join notifications. */
  onSnapshot(names: string[]): void {
    // The bot is always in its own room's visitor list. A list without it is
    // still loading (or broken) and must not become a baseline.
    if (!names.some((n) => this.isSelf(n))) return;
    this.online = new Set(names);
    this.hasBaseline = true;
  }

  private claim(name: string, now: number): boolean {
    if (this.isSelf(name)) return false;
    const last = this.lastNotified.get(name);
    if (last !== undefined && now - last < this.dedupeWindowMs) return false;
    this.lastNotified.set(name, now);
    if (this.lastNotified.size > 500) {
      for (const [k, t] of this.lastNotified) if (now - t > this.dedupeWindowMs) this.lastNotified.delete(k);
    }
    return true;
  }
}
