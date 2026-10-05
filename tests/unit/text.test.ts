import { describe, expect, test } from "bun:test";
import { escapeDiscord, formatRelay, splitMessage, toChatzyLine } from "../../src/text.ts";
import { loadChatzyConfig, loadDiscordConfig } from "../../src/config.ts";

const HOOK = "https://discord.com/api/webhooks/123/abc-DEF_9";

test("toChatzyLine flattens newlines and defuses slash commands", () => {
  expect(toChatzyLine(" hello\nworld\t ")).toBe("hello world");
  expect(toChatzyLine("/bye")).toBe("\u200b/bye");
  expect(toChatzyLine("[nora] /bye")).toBe("[nora] /bye");
});

test("splitMessage respects the limit and word boundaries", () => {
  expect(splitMessage("aaa bbb ccc ddd", 8)).toEqual(["aaa bbb", "ccc ddd"]);
  expect(splitMessage("x".repeat(20), 8)).toEqual(["xxxxxxxx", "xxxxxxxx", "xxxx"]);
});

const Z = "\u200b";

test("escapeDiscord neutralizes markdown and mention pills but keeps URLs intact", () => {
  expect(escapeDiscord("**bold** _x_")).toBe("\\*\\*bold\\*\\* \\_x\\_");
  expect(escapeDiscord("# heading")).toBe("\\# heading");
  expect(escapeDiscord("<@123> <t:1:R>")).toBe(`\\<@${Z}123\\> \\<t\\:1\\:R\\>`);
  expect(escapeDiscord("@everyone")).toBe(`@${Z}everyone`);
  expect(escapeDiscord("see https://ex.com/a_b-(c)?q=*x* ok_")).toBe("see https://ex.com/a_b-(c)?q=*x* ok\\_");
});

describe("formatRelay", () => {
  test("keeps inline formatting", () => {
    expect(formatRelay("**bold** *it* __u__ ~~s~~ ||spoiler|| `code`")).toBe(
      "**bold** *it* __u__ ~~s~~ ||spoiler|| `code`",
    );
  });
  test("breaks mention pills", () => {
    expect(formatRelay("hi @everyone and @here, ping @nora")).toBe(`hi @${Z}everyone and @${Z}here, ping @${Z}nora`);
    expect(formatRelay("<@123> <#456> <t:1:R>")).toBe(`\\<@${Z}123> \\<#456> \\<t:1:R>`);
    expect(formatRelay("mail me a@b.c")).toBe(`mail me a@${Z}b.c`);
  });
  test("disables masked links but keeps URLs", () => {
    expect(formatRelay("[free nitro](https://evil.example/x_y)")).toBe("\\[free nitro](https://evil.example/x_y)");
    expect(formatRelay("see https://example.com/a_b?x=@y")).toBe("see https://example.com/a_b?x=@y");
  });
  test("disables block formatting at the start", () => {
    expect(formatRelay("# big")).toBe("\\# big");
    expect(formatRelay("-# small")).toBe("\\-# small");
    expect(formatRelay("> quote")).toBe("\\> quote");
    expect(formatRelay("- item")).toBe("\\- item");
    expect(formatRelay("1. item")).toBe("\\1. item");
    expect(formatRelay("*not a list*")).toBe("*not a list*");
    expect(formatRelay("a # b > c")).toBe("a # b > c");
  });
});

test("chatzy config parsing", () => {
  const c = loadChatzyConfig({ CHATZY_ROOM_URL: "https://us28.chatzy.com/1", CHATZY_AUTO_JOIN: "true", DATA_DIR: "/tmp/x" });
  expect(c).toMatchObject({ autoJoin: true, alias: "Room Bot", profileDir: "/tmp/x/browser-profile", password: undefined });
  expect(() => loadChatzyConfig({})).toThrow(/CHATZY_ROOM_URL/);
});

test("discord config parsing", () => {
  expect(loadDiscordConfig({ DISCORD_WEBHOOK_URL: HOOK })).toEqual({
    relayWebhookUrl: HOOK,
    notifyWebhookUrl: HOOK,
    webhookName: "Chatzy Bot",
  });
  const other = "https://discord.com/api/webhooks/456/xyz";
  expect(loadDiscordConfig({ DISCORD_WEBHOOK_URL: HOOK, DISCORD_NOTIFY_WEBHOOK_URL: other }).notifyWebhookUrl).toBe(other);
  expect(loadDiscordConfig({ DISCORD_WEBHOOK_URL: HOOK, DISCORD_NOTIFY_WEBHOOK_URL: "" }).notifyWebhookUrl).toBe(HOOK);
  expect(() => loadDiscordConfig({})).toThrow(/DISCORD_WEBHOOK_URL/);
  expect(() => loadDiscordConfig({ DISCORD_WEBHOOK_URL: "https://example.com/api/webhooks/1/x" })).toThrow(/webhook/);
});
