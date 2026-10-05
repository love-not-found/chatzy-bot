import jokes from "../jokes/jokes.json" with { type: "json" };
import type { ChatzyCommand, CommandRegistry } from "./registry.ts";

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

export function createJokePicker(list: string[] = jokes, random = Math.random): () => string {
  let last = -1;
  return () => {
    if (list.length === 0) return "I'm all out of jokes.";
    let i = Math.floor(random() * list.length);
    if (list.length > 1 && i === last) i = (i + 1) % list.length;
    last = i;
    return list[i]!;
  };
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
