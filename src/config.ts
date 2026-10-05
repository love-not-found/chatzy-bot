import { z } from "zod";
import path from "node:path";

const idList = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().regex(/^\d+$/, "must be a numeric Discord ID")));

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
  DATA_DIR: z.string().default("./data"),
  NOVNC_PUBLIC_URL: optionalString,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  HEALTH_PORT: int(8080),
});

const discordSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().regex(/^\d+$/),
  DISCORD_RELAY_CHANNEL_ID: z.string().regex(/^\d+$/),
  DISCORD_NOTIFICATION_CHANNEL_ID: z.string().regex(/^\d+$/),
  DISCORD_ADMIN_USER_IDS: idList,
  DISCORD_ADMIN_ROLE_IDS: idList,
  DISCORD_RELAY_USER_IDS: idList,
  DISCORD_RELAY_ROLE_IDS: idList,
});

export interface ChatzyConfig {
  roomUrl: string;
  alias: string;
  password?: string;
  autoJoin: boolean;
  sendIntervalMs: number;
  maxAutoRetries: number;
  dataDir: string;
  profileDir: string;
  novncUrl?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  healthPort: number;
}

export interface DiscordConfig {
  token: string;
  guildId: string;
  relayChannelId: string;
  notificationChannelId: string;
  adminUserIds: string[];
  adminRoleIds: string[];
  relayUserIds: string[];
  relayRoleIds: string[];
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
    token: e.DISCORD_TOKEN,
    guildId: e.DISCORD_GUILD_ID,
    relayChannelId: e.DISCORD_RELAY_CHANNEL_ID,
    notificationChannelId: e.DISCORD_NOTIFICATION_CHANNEL_ID,
    adminUserIds: e.DISCORD_ADMIN_USER_IDS,
    adminRoleIds: e.DISCORD_ADMIN_ROLE_IDS,
    relayUserIds: e.DISCORD_RELAY_USER_IDS,
    relayRoleIds: e.DISCORD_RELAY_ROLE_IDS,
  };
}
