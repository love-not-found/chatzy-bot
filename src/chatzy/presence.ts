/**
 * Combines two join signals into one deduplicated stream:
 *  - Chatzy "X joined the chat" system lines (fast, primary)
 *  - visitor-list snapshot diffs (fallback if a line is missed)
 *
 * The first snapshot after (re)connecting only establishes a baseline and
 * never produces notifications.
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

  /** Returns names that should be announced as newly joined. */
  onSnapshot(names: string[], now = Date.now()): string[] {
    // The bot is always in its own room's visitor list. A list without it is
    // still loading (or broken) and must not become a baseline.
    if (!names.some((n) => this.isSelf(n))) return [];
    const next = new Set(names);
    if (!this.hasBaseline) {
      this.online = next;
      this.hasBaseline = true;
      return [];
    }
    const joined = names.filter((n) => !this.online.has(n) && this.claim(n, now));
    this.online = next;
    return joined;
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
