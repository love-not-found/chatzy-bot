import { createLogger } from "../logger.ts";

const log = createLogger("commands");

export interface CommandContext {
  /** Chatzy alias of the user who invoked the command. */
  user: string;
  /** Text after the command name, trimmed. */
  args: string;
  /** Reply into the Chatzy room. */
  reply(text: string): Promise<void>;
}

export interface ChatzyCommand {
  name: string;
  usage: string;
  description: string;
  /** Per-user cooldown in ms (default 3000). */
  cooldownMs?: number;
  run(ctx: CommandContext): Promise<void>;
}

export interface ParsedCommand {
  name: string;
  args: string;
}

/** "!Relay  hello world" -> { name: "relay", args: "hello world" } */
export function parseCommand(text: string, prefix = "!"): ParsedCommand | null {
  const t = text.trim();
  if (!t.startsWith(prefix)) return null;
  const m = /^(\w+)(?:\s+([\s\S]*))?$/.exec(t.slice(prefix.length));
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? "").trim() };
}

export class CommandRegistry {
  private commands = new Map<string, ChatzyCommand>();
  private lastUse = new Map<string, number>();

  register(cmd: ChatzyCommand): this {
    this.commands.set(cmd.name, cmd);
    return this;
  }

  list(): ChatzyCommand[] {
    return [...this.commands.values()];
  }

  /** Returns true if the text was a known command (handled or rate-limited). */
  async dispatch(user: string, text: string, reply: (t: string) => Promise<void>, now = Date.now()): Promise<boolean> {
    const parsed = parseCommand(text);
    if (!parsed) return false;
    const cmd = this.commands.get(parsed.name);
    if (!cmd) return false;

    const key = `${user}\u0000${cmd.name}`;
    const last = this.lastUse.get(key);
    if (last !== undefined && now - last < (cmd.cooldownMs ?? 3_000)) {
      log.debug("cooldown", { user, cmd: cmd.name });
      return true;
    }
    this.lastUse.set(key, now);

    log.info("command", { user, cmd: cmd.name });
    try {
      await cmd.run({ user, args: parsed.args, reply });
    } catch (e) {
      log.error("command failed", { cmd: cmd.name, error: e });
      await reply(`Sorry, !${cmd.name} failed.`).catch(() => {});
    }
    return true;
  }
}
