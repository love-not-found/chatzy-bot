import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadChatzyConfig, loadDiscordConfig } from "./config.ts";
import defaultJokes from "./jokes/jokes.json";
import { customCommandsSchema, type RandomSelector } from "./commands/random-selector.ts";

export interface SettingField {
  key: string;
  label: string;
  group: string;
  type: "text" | "password" | "number" | "checkbox" | "select";
  default: string;
  help?: string;
  options?: string[];
  min?: number;
  max?: number;
}

export const fields: SettingField[] = [
  { key: "CHATZY_ROOM_URL", label: "Room URL", group: "Chatzy", type: "text", default: "" },
  { key: "CHATZY_ALIAS", label: "Bot alias", group: "Chatzy", type: "text", default: "Room Bot" },
  { key: "CHATZY_PASSWORD", label: "Room password", group: "Chatzy", type: "password", default: "", help: "Optional when joining manually through VNC." },
  { key: "CHATZY_AUTO_JOIN", label: "Join automatically", group: "Chatzy", type: "checkbox", default: "false" },
  { key: "CHATZY_SEND_INTERVAL_MS", label: "Message spacing (ms)", group: "Chatzy", type: "number", default: "1200", min: 100, max: 60000 },
  { key: "DISCORD_WEBHOOK_URL", label: "Relay webhook URL", group: "Discord", type: "password", default: "" },
  { key: "DISCORD_NOTIFY_WEBHOOK_URL", label: "Notification webhook URL", group: "Discord", type: "password", default: "", help: "Leave empty to use the relay webhook." },
  { key: "DISCORD_WEBHOOK_NAME", label: "Notification display name", group: "Discord", type: "text", default: "Chatzy Bot" },
  { key: "NOTIFY_JOINS", label: "Join notifications", group: "Discord", type: "checkbox", default: "true" },
  { key: "NOTIFY_CONNECTION", label: "Connection alerts", group: "Discord", type: "checkbox", default: "true" },
  { key: "CHATZY_MAX_AUTO_RETRIES", label: "Recovery attempts", group: "Recovery", type: "number", default: "5", min: 0, max: 20 },
  { key: "CHATZY_RECOVERY_TIMEOUT_MS", label: "Recovery window (ms)", group: "Recovery", type: "number", default: "120000", min: 1000, max: 3600000 },
  { key: "CHATZY_KEEPALIVE", label: "Silent keep-alive", group: "Keep-alive", type: "checkbox", default: "true", help: "Opens and closes My Messages without posting in the room." },
  { key: "CHATZY_KEEPALIVE_MIN_MS", label: "Minimum interval (ms)", group: "Keep-alive", type: "number", default: "600000", min: 60000, max: 3000000 },
  { key: "CHATZY_KEEPALIVE_MAX_MS", label: "Maximum interval (ms)", group: "Keep-alive", type: "number", default: "1500000", min: 60000, max: 3000000 },
  { key: "COMMAND_PREFIX", label: "Command prefix", group: "Commands", type: "text", default: "!" },
  { key: "COMMAND_HELP", label: "Help command", group: "Commands", type: "checkbox", default: "true" },
  { key: "COMMAND_RELAY", label: "Relay command", group: "Commands", type: "checkbox", default: "true" },
  { key: "RELAY_COOLDOWN_MS", label: "Relay cooldown (ms)", group: "Commands", type: "number", default: "10000", min: 0, max: 3600000 },
  { key: "NOVNC_PUBLIC_URL", label: "Public VNC URL", group: "Browser & logging", type: "text", default: "", help: "Used by Open browser and manual-attention alerts." },
  { key: "VNC_PASSWORD", label: "VNC password", group: "Browser & logging", type: "password", default: "", help: "Maximum 8 characters. Changes take effect on container restart." },
  { key: "LOG_LEVEL", label: "Log level", group: "Browser & logging", type: "select", default: "info", options: ["debug", "info", "warn", "error"] },
];

const documentSchema = z.object({ version: z.literal(1), env: z.record(z.string(), z.string()) }).strict();
const jokesSchema = z.array(z.string().trim().min(1).max(3900)).max(1000);
const commandsDocumentSchema = z.object({ version: z.literal(1), commands: customCommandsSchema }).strict();

export class SettingsStore {
  env: Record<string, string> = {};
  commands: RandomSelector[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string, private readonly bootstrap = process.env) {}

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    let saved: Record<string, string> | undefined;
    try {
      saved = documentSchema.parse(JSON.parse(await readFile(path.join(this.dir, "settings.json"), "utf8"))).env;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    this.env = Object.fromEntries(fields.map((f) => [f.key, saved?.[f.key] ?? (saved ? f.default : this.bootstrap[f.key] ?? f.default)]));
    this.validate(this.env);
    try {
      this.commands = commandsDocumentSchema.parse(JSON.parse(await readFile(path.join(this.dir, "commands.json"), "utf8"))).commands;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      // One-time migration: keep the original jokes.json untouched as a backup.
      let jokes = [...defaultJokes];
      try {
        jokes = jokesSchema.parse(JSON.parse(await readFile(path.join(this.dir, "jokes.json"), "utf8")));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      this.commands = customCommandsSchema.parse([{
        id: "joke", category: "random-selector", name: "joke", description: "tell a joke",
        enabled: (saved?.COMMAND_JOKE ?? this.bootstrap.COMMAND_JOKE) !== "false",
        cooldownMs: Number(saved?.JOKE_COOLDOWN_MS ?? this.bootstrap.JOKE_COOLDOWN_MS ?? 5000),
        // Older joke entries could contain line breaks; preserve each as one
        // response, matching the sender's previous single-line behavior.
        avoidRepeats: true, values: jokes.map((joke) => joke.replace(/[\r\n]+/g, " ")),
      }]);
      await this.atomic("commands.json", { version: 1, commands: this.commands });
    }
    if (!saved) await this.atomic("settings.json", { version: 1, env: this.env });
  }

  configured(): boolean {
    return !!this.env.CHATZY_ROOM_URL && !!this.env.DISCORD_WEBHOOK_URL;
  }

  runtimeEnv(): Record<string, string> {
    return { ...this.env, DATA_DIR: this.dir };
  }

  publicSettings() {
    const secretSet: Record<string, boolean> = {};
    const env = { ...this.env };
    for (const f of fields.filter((f) => f.type === "password")) {
      secretSet[f.key] = !!env[f.key];
      env[f.key] = "";
    }
    return { env, secretSet, fields, configured: this.configured() };
  }

  /** Omitted secret values retain the stored secret; an explicit empty string clears it. */
  saveEnv(patch: unknown): Promise<void> {
    return this.serial(async () => {
      const values = z.record(z.string(), z.string()).parse(patch);
      const next = { ...this.env, ...values };
      for (const key of Object.keys(values)) if (!fields.some((f) => f.key === key)) throw new Error(`Unknown setting: ${key}`);
      this.validate(next);
      await this.atomic("settings.json", { version: 1, env: next });
      this.env = next;
    });
  }

  /** Compatibility accessor for the earlier joke API; commands.json is authoritative. */
  get jokes(): string[] {
    return this.commands.find((command) => command.name === "joke")?.values ?? [];
  }

  saveCommands(value: unknown): Promise<void> {
    return this.serial(async () => {
      const next = customCommandsSchema.parse(value);
      await this.atomic("commands.json", { version: 1, commands: next });
      this.commands = next;
    });
  }

  saveJokes(value: unknown): Promise<void> {
    return this.serial(async () => {
      const next = jokesSchema.parse(value);
      if (!this.commands.some((command) => command.name === "joke")) throw new Error("The joke random-selector command does not exist");
      const commands = customCommandsSchema.parse(this.commands.map((command) => command.name === "joke" ? { ...command, values: next } : command));
      await this.atomic("commands.json", { version: 1, commands });
      this.commands = commands;
    });
  }

  private validate(env: Record<string, string>): void {
    for (const f of fields) {
      const value = env[f.key] ?? "";
      if (value.length > 4096) throw new Error(`${f.label}: too long`);
      if (f.type === "checkbox" && !["true", "false"].includes(value)) throw new Error(`${f.label}: must be true or false`);
      if (f.type === "number") {
        const n = Number(value);
        if (!value || !Number.isInteger(n) || n < (f.min ?? 0) || n > (f.max ?? Infinity)) throw new Error(`${f.label}: outside allowed range`);
      }
      if (f.options && !f.options.includes(value)) throw new Error(`${f.label}: invalid choice`);
    }
    if (!env.CHATZY_ALIAS?.trim()) throw new Error("Bot alias is required");
    if (!env.DISCORD_WEBHOOK_NAME?.trim() || env.DISCORD_WEBHOOK_NAME.length > 80) throw new Error("Notification display name must be 1–80 characters");
    if (!env.COMMAND_PREFIX || env.COMMAND_PREFIX.length > 4 || /\s|\w/.test(env.COMMAND_PREFIX)) throw new Error("Prefix must be 1–4 punctuation characters");
    if ((env.VNC_PASSWORD ?? "").length > 8) throw new Error("VNC password must be at most 8 characters");
    if (Number(env.CHATZY_KEEPALIVE_MIN_MS) > Number(env.CHATZY_KEEPALIVE_MAX_MS)) throw new Error("Keep-alive minimum cannot exceed maximum");
    if (env.NOVNC_PUBLIC_URL) {
      const url = new URL(env.NOVNC_PUBLIC_URL);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("VNC URL must use HTTP or HTTPS");
    }
    if (env.CHATZY_ROOM_URL) {
      const url = new URL(env.CHATZY_ROOM_URL);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Room URL must use HTTP or HTTPS");
      loadChatzyConfig({ ...env, DATA_DIR: this.dir });
    }
    if (env.DISCORD_WEBHOOK_URL) loadDiscordConfig(env);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => {});
    return run;
  }

  private async atomic(name: string, value: unknown): Promise<void> {
    const file = path.join(this.dir, name);
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await rename(temp, file);
  }
}
