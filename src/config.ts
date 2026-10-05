import { z } from "zod";
import path from "node:path";
import { WEBHOOK_URL_RE } from "./discord/webhook.ts";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : /^(1|true|yes|on)$/i.test(v)));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : Number(v)))
    .pipe(z.number().int().nonnegative());

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const chatzySchema = z.object({
  CHATZY_ROOM_URL: z.url(),
  CHATZY_ALIAS: z.string().min(1).default("Room Bot"),
  CHATZY_PASSWORD: optionalString,
  CHATZY_AUTO_JOIN: bool(false),
  CHATZY_SEND_INTERVAL_MS: int(1200),
  CHATZY_MAX_AUTO_RETRIES: int(5),
  CHATZY_RECOVERY_TIMEOUT_MS: int(120_000).pipe(z.number().positive()),
  DATA_DIR: z.string().default("./data"),
  NOVNC_PUBLIC_URL: optionalString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  HEALTH_PORT: int(8080),
});

const webhookUrl = z
  .string()
  .regex(WEBHOOK_URL_RE, "must be a Discord webhook URL (https://discord.com/api/webhooks/<id>/<token>)");

const discordSchema = z.object({
  DISCORD_WEBHOOK_URL: webhookUrl,
  DISCORD_NOTIFY_WEBHOOK_URL: z.union([z.literal(""), webhookUrl]).optional(),
  DISCORD_WEBHOOK_NAME: z.string().min(1).max(80).default("Chatzy Bot"),
});

export interface ChatzyConfig {
  roomUrl: string;
  alias: string;
  password?: string;
  autoJoin: boolean;
  sendIntervalMs: number;
  maxAutoRetries: number;
  recoveryTimeoutMs: number;
  dataDir: string;
  profileDir: string;
  novncUrl?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  healthPort: number;
}

export interface DiscordConfig {
  /** Receives !relay messages. */
  relayWebhookUrl: string;
  /** Receives join notices and connection alerts (defaults to the relay webhook). */
  notifyWebhookUrl: string;
  /** Display name for notices. */
  webhookName: string;
}

function formatError(prefix: string, err: z.ZodError): Error {
  const lines = err.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  return new Error(`${prefix}\n${lines.join("\n")}`);
}

export function loadChatzyConfig(env: Record<string, string | undefined> = process.env): ChatzyConfig {
  const r = chatzySchema.safeParse(env);
  if (!r.success) throw formatError("Invalid Chatzy configuration:", r.error);
  const e = r.data;
  const dataDir = path.resolve(e.DATA_DIR);
  return {
    roomUrl: e.CHATZY_ROOM_URL,
    alias: e.CHATZY_ALIAS,
    password: e.CHATZY_PASSWORD,
    autoJoin: e.CHATZY_AUTO_JOIN,
    sendIntervalMs: e.CHATZY_SEND_INTERVAL_MS,
    maxAutoRetries: e.CHATZY_MAX_AUTO_RETRIES,
    recoveryTimeoutMs: e.CHATZY_RECOVERY_TIMEOUT_MS,
    dataDir,
    profileDir: path.join(dataDir, "browser-profile"),
    novncUrl: e.NOVNC_PUBLIC_URL,
    logLevel: e.LOG_LEVEL,
    healthPort: e.HEALTH_PORT,
  };
}

export function loadDiscordConfig(env: Record<string, string | undefined> = process.env): DiscordConfig {
  const r = discordSchema.safeParse(env);
  if (!r.success) throw formatError("Invalid Discord configuration:", r.error);
  const e = r.data;
  return {
    relayWebhookUrl: e.DISCORD_WEBHOOK_URL,
    notifyWebhookUrl: e.DISCORD_NOTIFY_WEBHOOK_URL || e.DISCORD_WEBHOOK_URL,
    webhookName: e.DISCORD_WEBHOOK_NAME,
  };
}
