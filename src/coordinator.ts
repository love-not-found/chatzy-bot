import { helpCommand, jokeCommand, relayCommand } from "./commands/builtin.ts";
import { CommandRegistry } from "./commands/registry.ts";
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

export function buildRegistry(outlet: Outlet): CommandRegistry {
  const registry = new CommandRegistry();
  registry.register(helpCommand(registry));
  registry.register(jokeCommand());
  registry.register(relayCommand((user, text) => outlet.relayFromChatzy(user, text)));
  return registry;
}

/** Session handlers that connect Chatzy events to commands and notifications. */
export function createHandlers(
  getChatzy: () => ChatzySide,
  outlet: Outlet,
  opts: { novncUrl?: string } = {},
): SessionHandlers {
  const registry = buildRegistry(outlet);
  let everConnected = false;

  return {
    onEvent(ev: ChatzyEvent) {
      if (ev.type !== "message") return;
      const chatzy = getChatzy();
      if (chatzy.isSelf(ev.user)) return; // never react to our own output
      const reply = (t: string) => chatzy.send(t);
      registry.dispatch(ev.user, ev.text, reply).catch((e) => log.error("dispatch failed", { error: e }));
    },
    onJoin(user) {
      void outlet.notifyJoin(user);
    },
    onStateChange(state, prev, reason) {
      const browser = opts.novncUrl
        ? ` Open the browser: ${opts.novncUrl}`
        : " Open noVNC (port 6080) on the bot server to take control.";
      if (state === "connected") {
        void outlet.notify(everConnected ? "Chatzy connection restored." : "Chatzy bot is connected to the room.");
        everConnected = true;
      } else if (state === "disconnected" && prev === "connected") {
        void outlet.notify(`Chatzy connection lost (${reason ?? "unknown"}). Trying to recover.`);
      } else if (state === "waiting_for_operator") {
        void outlet.notify(`Chatzy needs manual attention: ${reason ?? "unknown"}.${browser}`);
      }
    },
    onSelectorWarning(missing) {
      void outlet.notify(
        `Some Chatzy page hooks were not found (${missing.join(", ")}). Chatzy may have changed its page; some features may not work.`,
      );
    },
  };
}
