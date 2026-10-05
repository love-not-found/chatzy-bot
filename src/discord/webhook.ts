import { createLogger } from "../logger.ts";
import { truncate } from "../text.ts";

const log = createLogger("webhook");

export const WEBHOOK_URL_RE =
  /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

export interface WebhookMessage {
  content: string;
  /** Overrides the webhook's display name for this message. */
  username?: string;
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

const MAX_ATTEMPTS = 4;

/**
 * Discord rejects webhook usernames containing "discord" or "clyde", or equal
 * to "everyone"/"here". Length must be 1-80.
 */
export function webhookUsername(name: string, fallback = "Chatzy"): string {
  let n = name
    .replace(/discord/gi, (m) => m[0] + "_" + m.slice(1))
    .replace(/clyde/gi, (m) => m[0] + "_" + m.slice(1))
    .replace(/\s+/g, " ")
    .trim();
  if (!n || /^(everyone|here)$/i.test(n)) n = fallback;
  return truncate(n, 80);
}

/**
 * Minimal Discord webhook client. Messages are sent one at a time in order,
 * mentions are always disabled, and rate limits / 5xx errors are retried.
 */
export class DiscordWebhook {
  private chain: Promise<unknown> = Promise.resolve();
  private _lastError: string | null = null;
  private _lastSuccessAt: number | null = null;

  constructor(
    private readonly url: string,
    private readonly defaultName: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
  ) {
    if (!WEBHOOK_URL_RE.test(url)) throw new Error("invalid Discord webhook URL");
  }

  get lastError(): string | null {
    return this._lastError;
  }

  get lastSuccessAt(): number | null {
    return this._lastSuccessAt;
  }

  /** Queue a message. Resolves once Discord accepted it; rejects after retries fail. */
  send(msg: WebhookMessage): Promise<void> {
    const run = this.chain.then(() => this.deliver(msg));
    this.chain = run.catch(() => {});
    return run;
  }

  private async deliver(msg: WebhookMessage): Promise<void> {
    const body = JSON.stringify({
      content: truncate(msg.content, 2000),
      username: webhookUsername(msg.username ?? this.defaultName, this.defaultName),
      allowed_mentions: { parse: [] },
    });

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.url}?wait=true`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS) return this.fail(`network error: ${(e as Error).message}`);
        await this.sleep(1_000 * 2 ** attempt);
        continue;
      }

      if (res.ok) {
        const posted = (await res.json().catch(() => null)) as { id?: string; channel_id?: string } | null;
        log.info("posted", { id: posted?.id, channel: posted?.channel_id });
        this._lastError = null;
        this._lastSuccessAt = Date.now();
        return;
      }

      const text = await res.text().catch(() => "");
      if (res.status === 429 && attempt < MAX_ATTEMPTS) {
        let retry = Number(res.headers.get("retry-after") ?? "1");
        try {
          retry = Number(JSON.parse(text).retry_after ?? retry);
        } catch {
          /* not JSON */
        }
        log.warn("rate limited", { retryAfterS: retry });
        await this.sleep(Math.ceil(Math.max(retry, 0.5) * 1000));
        continue;
      }
      if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
        await this.sleep(1_000 * 2 ** attempt);
        continue;
      }
      // 401/404 = webhook deleted or token wrong; 400 = bad payload.
      return this.fail(`HTTP ${res.status}: ${truncate(text, 300)}`);
    }
  }

  private fail(reason: string): never {
    this._lastError = reason;
    log.error("webhook delivery failed", { reason });
    throw new Error(`Discord webhook failed (${reason})`);
  }
}
