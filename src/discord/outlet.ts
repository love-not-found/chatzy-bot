import type { DiscordConfig } from "../config.ts";
import type { Outlet } from "../coordinator.ts";
import { createLogger } from "../logger.ts";
import { escapeDiscord, formatRelay } from "../text.ts";
import { DiscordWebhook } from "./webhook.ts";

const log = createLogger("discord");

export interface WebhookOutlet extends Outlet {
  status(): { lastError: string | null; lastSuccessAt: number | null };
}

/** One-way Chatzy -> Discord output over webhooks. */
export function createWebhookOutlet(config: DiscordConfig, fetchFn?: typeof fetch): WebhookOutlet {
  const relay = new DiscordWebhook(config.relayWebhookUrl, config.webhookName, fetchFn);
  const notify =
    config.notifyWebhookUrl === config.relayWebhookUrl
      ? relay
      : new DiscordWebhook(config.notifyWebhookUrl, config.webhookName, fetchFn);

  const notice = (content: string) =>
    notify.send({ content }).catch((e) => log.warn("notice not delivered", { error: e }));

  return {
    // Relayed messages appear under the Chatzy user's name. Errors propagate so
    // the Chatzy user is told the relay failed.
    relayFromChatzy: (user, text) => relay.send({ username: `${user} (Chatzy)`, content: formatRelay(text) }),
    notifyJoin: (user) => notice(`*${escapeDiscord(user)} joined the Chatzy room.*`),
    notify: (text) => notice(text),
    status: () => {
      const errs = [relay, notify].map((w) => w.lastError).filter(Boolean);
      const ok = [relay, notify].map((w) => w.lastSuccessAt ?? 0);
      return { lastError: errs[0] ?? null, lastSuccessAt: Math.max(...ok) || null };
    },
  };
}
