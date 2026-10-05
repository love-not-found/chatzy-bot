import { splitMessage, toChatzyLine } from "../text.ts";

interface Job {
  text: string;
  resolve: () => void;
  reject: (e: Error) => void;
}

/**
 * Serializes all outgoing Chatzy messages with a minimum gap between them.
 * `deliver` performs one actual send in the browser.
 */
export class SendQueue {
  private jobs: Job[] = [];
  private running = false;
  private lastSentAt = 0;
  private closed = false;

  constructor(
    private readonly deliver: (line: string) => Promise<void>,
    private readonly intervalMs: number,
    private readonly maxQueued = 20,
  ) {}

  get pending(): number {
    return this.jobs.length;
  }

  /** Queue user-visible text. Long text is split; resolves when all parts are sent. */
  async send(text: string): Promise<void> {
    const line = toChatzyLine(text);
    if (!line) return;
    const parts = splitMessage(line);
    await Promise.all(parts.map((p) => this.enqueue(p)));
  }

  /** Queue a raw Chatzy command such as "/bye" (not sanitized). */
  command(cmd: string): Promise<void> {
    return this.enqueue(cmd);
  }

  /** Reject everything still waiting (used on disconnect/shutdown). */
  clear(reason: string): void {
    const jobs = this.jobs.splice(0);
    for (const j of jobs) j.reject(new Error(reason));
  }

  close(): void {
    this.closed = true;
    this.clear("sender closed");
  }

  /** Wait until the queue is empty or the timeout elapses. */
  async drain(timeoutMs: number): Promise<void> {
    const end = Date.now() + timeoutMs;
    while ((this.running || this.jobs.length) && Date.now() < end) await Bun.sleep(50);
  }

  private enqueue(text: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("sender closed"));
    if (this.jobs.length >= this.maxQueued) return Promise.reject(new Error("send queue is full"));
    return new Promise((resolve, reject) => {
      this.jobs.push({ text, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let job: Job | undefined;
      while ((job = this.jobs.shift())) {
        const wait = this.lastSentAt + this.intervalMs - Date.now();
        if (wait > 0) await Bun.sleep(wait);
        try {
          await this.deliver(job.text);
          this.lastSentAt = Date.now();
          job.resolve();
        } catch (e) {
          job.reject(e instanceof Error ? e : new Error(String(e)));
        }
      }
    } finally {
      this.running = false;
    }
  }
}
