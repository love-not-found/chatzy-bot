import { helpCommand, relayCommand } from "./commands/builtin.ts";
import { CommandRegistry } from "./commands/registry.ts";
import { randomSelectorCommands, type RandomSelector } from "./commands/random-selector.ts";
import defaultJokes from "./jokes/jokes.json";
import type { SessionHandlers } from "./chatzy/session.ts";
import type { ChatzyEvent } from "./chatzy/types.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("coordinator");

/** The outward-facing side (Discord, or the console harness). */
export interface Outlet {
  relayFromChatzy(user: string, text: string): Promise<void>;
  notifyJoin(user: string): Promise<void>;
  notify(text: string): Promise<void>;
}

export interface ChatzySide {
  isSelf(name: string): boolean;
  send(text: string): Promise<void>;
}

export function buildRegistry(outlet: Outlet, env: Record<string, string> = {}, commands?: () => RandomSelector[]): CommandRegistry {
  const prefix = env.COMMAND_PREFIX ?? "!";
  // The console harness retains a default joke command without a SettingsStore.
  const defaults: RandomSelector[] = [{ id: "joke", category: "random-selector", name: "joke", description: "tell a joke", enabled: env.COMMAND_JOKE !== "false", cooldownMs: Number(env.JOKE_COOLDOWN_MS ?? 5000), avoidRepeats: true, values: [...defaultJokes] }];
  const registry = new CommandRegistry(prefix, randomSelectorCommands(commands ?? (() => defaults), prefix));
  const help = helpCommand(registry);
  const relay = relayCommand((user, text) => outlet.relayFromChatzy(user, text));
  relay.cooldownMs = Number(env.RELAY_COOLDOWN_MS ?? 10000);
  const runRelay = relay.run;
  relay.run = (ctx) => ctx.args ? runRelay(ctx) : ctx.reply(`Usage: ${prefix}relay <message>`);
  for (const cmd of [help, relay]) {
    cmd.usage = cmd.usage.replace(/^!/, prefix);
    if (env[`COMMAND_${cmd.name.toUpperCase()}`] !== "false") registry.register(cmd);
  }
  return registry;
}

/** Session handlers that connect Chatzy events to commands and notifications. */
export function createHandlers(
  getChatzy: () => ChatzySide,
  outlet: Outlet,
  opts: { novncUrl?: string; env?: Record<string, string>; commands?: () => RandomSelector[] } = {},
): SessionHandlers {
  const registry = buildRegistry(outlet, opts.env, opts.commands);
  let everConnected = false;
  let outageAnnounced = false;

  return {
    onEvent(ev: ChatzyEvent) {
      if (ev.type !== "message") return;
      const chatzy = getChatzy();
      if (chatzy.isSelf(ev.user)) return; // never react to our own output
      const reply = (t: string) => chatzy.send(t);
      registry.dispatch(ev.user, ev.text, reply).catch((e) => log.error("dispatch failed", { error: e }));
    },
    onJoin(user) {
      if (opts.env?.NOTIFY_JOINS !== "false") void outlet.notifyJoin(user);
    },
    onStateChange(state, _prev, reason) {
      if (opts.env?.NOTIFY_CONNECTION === "false") return;
      const browser = opts.novncUrl
        ? ` Open the browser: ${opts.novncUrl}`
        : " Open noVNC (port 6080) on the bot server to take control.";
      if (state === "connected") {
        if (!everConnected || outageAnnounced) {
          void outlet.notify(everConnected ? "Chatzy connection restored." : "Chatzy bot is connected to the room.");
        }
        everConnected = true;
        outageAnnounced = false;
      } else if (state === "waiting_for_operator") {
        outageAnnounced = true;
        void outlet.notify(`Chatzy needs manual attention: ${reason ?? "unknown"}.${browser}`);
      }
    },
    onSelectorWarning(missing) {
      if (opts.env?.NOTIFY_CONNECTION === "false") return;
      void outlet.notify(
        `Some Chatzy page hooks were not found (${missing.join(", ")}). Chatzy may have changed its page; some features may not work.`,
      );
    },
  };
}
