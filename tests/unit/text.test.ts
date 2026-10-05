import { expect, test } from "bun:test";
import { escapeDiscord, splitMessage, toChatzyLine } from "../../src/text.ts";
import { isAllowed } from "../../src/discord/permissions.ts";
import { loadChatzyConfig, loadDiscordConfig } from "../../src/config.ts";

test("toChatzyLine flattens newlines and defuses slash commands", () => {
  expect(toChatzyLine(" hello\nworld\t ")).toBe("hello world");
  expect(toChatzyLine("/bye")).toBe("\u200b/bye");
  expect(toChatzyLine("[nora] /bye")).toBe("[nora] /bye");
});

test("splitMessage respects the limit and word boundaries", () => {
  const parts = splitMessage("aaa bbb ccc ddd", 8);
  expect(parts).toEqual(["aaa bbb", "ccc ddd"]);
  expect(splitMessage("x".repeat(20), 8)).toEqual(["xxxxxxxx", "xxxxxxxx", "xxxx"]);
});

test("escapeDiscord neutralizes markdown", () => {
  expect(escapeDiscord("**bold** _x_")).not.toContain("**bold**");
});

test("permissions", () => {
  expect(isAllowed({ userIds: [], roleIds: [] }, { id: "1", roleIds: [] })).toBe(true);
  expect(isAllowed({ userIds: ["1"], roleIds: [] }, { id: "2", roleIds: [] })).toBe(false);
  expect(isAllowed({ userIds: [], roleIds: ["9"] }, { id: "2", roleIds: ["9"] })).toBe(true);
});

test("config parsing", () => {
  const c = loadChatzyConfig({ CHATZY_ROOM_URL: "https://us28.chatzy.com/1", CHATZY_AUTO_JOIN: "true", DATA_DIR: "/tmp/x" });
  expect(c).toMatchObject({ autoJoin: true, alias: "Room Bot", profileDir: "/tmp/x/browser-profile", password: undefined });
  expect(() => loadChatzyConfig({})).toThrow(/CHATZY_ROOM_URL/);
  const d = loadDiscordConfig({
    DISCORD_TOKEN: "t",
    DISCORD_GUILD_ID: "1",
    DISCORD_RELAY_CHANNEL_ID: "2",
    DISCORD_NOTIFICATION_CHANNEL_ID: "3",
    DISCORD_ADMIN_ROLE_IDS: "4, 5",
  });
  expect(d.adminRoleIds).toEqual(["4", "5"]);
  expect(d.relayUserIds).toEqual([]);
});
