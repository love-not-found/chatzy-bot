import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SendableChannels,
} from "discord.js";
import type { SessionStatus } from "../chatzy/session.ts";
import type { DiscordConfig } from "../config.ts";
import { createLogger } from "../logger.ts";
import { escapeDiscord, formatDuration, truncate } from "../text.ts";
import { isAllowed, type AccessPolicy, type Invoker } from "./permissions.ts";

const log = createLogger("discord");

/** What the Discord side needs from the Chatzy side. */
export interface ChatzyControl {
  status(): SessionStatus;
  send(text: string): Promise<void>;
  reload(): Promise<void>;
  reconnect(): Promise<void>;
  novncUrl?: string;
}

const RELAY_MAX = 1500;

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("relay")
    .setDescription("Send a message into the Chatzy room")
    .addStringOption((o) =>
      o.setName("message").setDescription("Text to send").setRequired(true).setMaxLength(RELAY_MAX),
    ),
  new SlashCommandBuilder().setName("status").setDescription("Show the Chatzy connection status"),
  new SlashCommandBuilder().setName("who").setDescription("List users currently online in Chatzy"),
  new SlashCommandBuilder()
    .setName("reload")
    .setDescription("Reload the Chatzy browser page")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reconnect")
    .setDescription("Reset retries and reopen the Chatzy room")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("browser")
    .setDescription("Get the link for manual browser control")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

const ADMIN_COMMANDS = new Set(["reload", "reconnect", "browser"]);

function invokerOf(i: ChatInputCommandInteraction): Invoker {
  const m = i.member;
  let roleIds: string[] = [];
  if (m) roleIds = Array.isArray(m.roles) ? m.roles : [...m.roles.cache.keys()];
  return { id: i.user.id, roleIds };
}

function displayNameOf(i: ChatInputCommandInteraction): string {
  const m = i.member;
  if (m && "displayName" in m && typeof m.displayName === "string") return m.displayName;
  if (m && "nick" in m && m.nick) return m.nick;
  return i.user.globalName ?? i.user.username;
}

function ago(t: number | null): string {
  return t ? `${formatDuration(Date.now() - t)} ago` : "never";
}

export class DiscordBot {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private readonly startedAt = Date.now();
  private readonly admin: AccessPolicy;
  private readonly relay: AccessPolicy;
  private accepting = true;

  constructor(
    private readonly config: DiscordConfig,
    private readonly chatzy: ChatzyControl,
  ) {
    this.admin = { userIds: config.adminUserIds, roleIds: config.adminRoleIds };
    this.relay = { userIds: config.relayUserIds, roleIds: config.relayRoleIds };
  }

  get ready(): boolean {
    return this.client.isReady();
  }

  async start(): Promise<void> {
    const ready = new Promise<void>((resolve) => this.client.once(Events.ClientReady, () => resolve()));
    this.client.on(Events.InteractionCreate, (i) => {
      if (i.isChatInputCommand()) void this.handle(i);
    });
    this.client.on(Events.Error, (e) => log.error("client error", { error: e }));
    await this.client.login(this.config.token);
    await ready;
    log.info("logged in", { user: this.client.user?.tag });
    await this.client.application!.commands.set(
      commandDefinitions.map((c) => c.toJSON()),
      this.config.guildId,
    );
    log.info("slash commands registered", { guild: this.config.guildId });
  }

  async stop(): Promise<void> {
    this.accepting = false;
    await this.client.destroy();
  }

  /** Post a Chatzy -> Discord relay message. Throws if delivery fails. */
  async postRelay(user: string, text: string): Promise<void> {
    const content = truncate(`**[Chatzy] ${escapeDiscord(user)}:** ${escapeDiscord(text)}`, 2000);
    await this.post(this.config.relayChannelId, content);
  }

  /** Post a small notice; failures are logged, not thrown. */
  async notify(content: string): Promise<void> {
    await this.post(this.config.notificationChannelId, truncate(content, 2000)).catch((e) =>
      log.warn("notification failed", { error: e }),
    );
  }

  async notifyJoin(user: string): Promise<void> {
    await this.notify(`*${escapeDiscord(user)} joined the Chatzy room.*`);
  }

  private async post(channelId: string, content: string): Promise<void> {
    if (!this.client.isReady()) throw new Error("Discord is not connected");
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`channel ${channelId} is not a sendable channel`);
    await (channel as SendableChannels).send({ content, allowedMentions: { parse: [] } });
  }

  private async handle(i: ChatInputCommandInteraction): Promise<void> {
    const ephemeral = { flags: MessageFlags.Ephemeral } as const;
    try {
      if (!this.accepting) return void (await i.reply({ content: "Bot is shutting down.", ...ephemeral }));
      if (i.guildId !== this.config.guildId) {
        return void (await i.reply({ content: "This bot only works in its configured server.", ...ephemeral }));
      }
      const who = invokerOf(i);
      const policy = ADMIN_COMMANDS.has(i.commandName) ? this.admin : i.commandName === "relay" ? this.relay : null;
      if (policy && !isAllowed(policy, who)) {
        return void (await i.reply({ content: "You are not allowed to use this command.", ...ephemeral }));
      }
      log.info("slash command", { cmd: i.commandName, user: i.user.id });

      switch (i.commandName) {
        case "relay": {
          await i.deferReply(ephemeral);
          const message = i.options.getString("message", true);
          await this.chatzy.send(`[${displayNameOf(i)}] ${message}`);
          await i.editReply("Sent to Chatzy.");
          return;
        }
        case "status":
          return void (await i.reply({ content: this.statusText(), ...ephemeral }));
        case "who": {
          const s = this.chatzy.status();
          const names = s.online.map(escapeDiscord);
          const content =
            s.state !== "connected"
              ? `Chatzy is not connected (${s.state}).`
              : names.length
                ? `**${names.length} online:** ${names.join(", ")}`
                : "Nobody is listed as online (or the visitor list is unavailable).";
          return void (await i.reply({ content: truncate(content, 2000), ...ephemeral }));
        }
        case "reload":
          await i.deferReply(ephemeral);
          await this.chatzy.reload();
          await i.editReply("Page reloaded.");
          return;
        case "reconnect":
          await i.deferReply(ephemeral);
          await this.chatzy.reconnect();
          await i.editReply("Reconnect started. Use /status to follow progress.");
          return;
        case "browser":
          return void (await i.reply({
            content: this.chatzy.novncUrl
              ? `Manual browser control: ${this.chatzy.novncUrl}`
              : "NOVNC_PUBLIC_URL is not set. Open port 6080 on the bot server in a browser (LAN/VPN only).",
            ...ephemeral,
          }));
        default:
          await i.reply({ content: "Unknown command.", ...ephemeral });
      }
    } catch (e) {
      log.warn("slash command failed", { cmd: i.commandName, error: e });
      const msg = `Failed: ${e instanceof Error ? e.message : String(e)}`;
      if (i.deferred || i.replied) await i.editReply(msg).catch(() => {});
      else await i.reply({ content: msg, ...ephemeral }).catch(() => {});
    }
  }

  private statusText(): string {
    const s = this.chatzy.status();
    const lines = [
      `**Chatzy:** ${s.state}${s.state === "connected" ? ` as ${escapeDiscord(s.alias)} (for ${formatDuration(Date.now() - (s.connectedSince ?? Date.now()))})` : ""}`,
      `**Page:** ${s.pageKind ?? "unknown"}`,
      `**Online in room:** ${s.online.length}`,
      `**Last room activity:** ${ago(s.lastEventAt)}`,
      `**Recovery attempts:** ${s.failures}`,
      `**Discord latency:** ${this.client.ws.ping}ms`,
      `**Bot uptime:** ${formatDuration(Date.now() - this.startedAt)}`,
    ];
    return lines.join("\n");
  }
}
