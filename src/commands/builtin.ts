import jokes from "../jokes/jokes.json" with { type: "json" };
import type { ChatzyCommand, CommandRegistry } from "./registry.ts";
import { createRandomPicker } from "./random-selector.ts";

export function helpCommand(registry: CommandRegistry): ChatzyCommand {
  return {
    name: "help",
    usage: "!help",
    description: "list bot commands",
    async run({ reply }) {
      const list = registry.list().map((c) => `${c.usage} (${c.description})`);
      await reply(`Bot commands: ${list.join(" | ")}`);
    },
  };
}

export function createJokePicker(source: string[] | (() => string[]) = jokes, random = Math.random): () => string {
  const pick = createRandomPicker(typeof source === "function" ? source : () => source, random);
  return () => pick() ?? "I'm all out of jokes.";
}

export function jokeCommand(pick = createJokePicker()): ChatzyCommand {
  return {
    name: "joke",
    usage: "!joke",
    description: "tell a joke",
    cooldownMs: 5_000,
    async run({ reply }) {
      await reply(pick());
    },
  };
}

/** Sends `!relay <message>` to Discord via the provided function. */
export function relayCommand(toDiscord: (user: string, text: string) => Promise<void>): ChatzyCommand {
  return {
    name: "relay",
    usage: "!relay <message>",
    description: "send a message to Discord",
    cooldownMs: 10_000,
    async run({ user, args, reply }) {
      if (!args) {
        await reply("Usage: !relay <message>");
        return;
      }
      try {
        await toDiscord(user, args);
      } catch {
        await reply("Relay to Discord failed, please try again later.");
      }
    },
  };
}
