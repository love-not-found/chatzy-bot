import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { SettingsStore } from "../../src/settings.ts";
import { buildRegistry } from "../../src/coordinator.ts";
import { createWebHandler } from "../../src/web/server.ts";

const dirs: string[] = [];
const hook = "https://discord.com/api/webhooks/123/testing-token";
async function store(env: Record<string, string> = {}) {
  const dir = await mkdtemp("/tmp/chatzy-settings-test-");
  dirs.push(dir);
  const s = new SettingsStore(dir, env);
  await s.load();
  return s;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

test("environment seeds once; saved settings override future environments", async () => {
  const s = await store({ CHATZY_ROOM_URL: "https://us28.chatzy.com/1", DISCORD_WEBHOOK_URL: hook, CHATZY_ALIAS: "Seed" });
  expect(s.configured()).toBe(true);
  await s.saveEnv({ CHATZY_ALIAS: "Saved", CHATZY_PASSWORD: "room-secret" });
  const restarted = new SettingsStore(s.dir, { CHATZY_ALIAS: "Wrong", DISCORD_WEBHOOK_URL: "bad" });
  await restarted.load();
  expect(restarted.env.CHATZY_ALIAS).toBe("Saved");
  expect(restarted.env.CHATZY_PASSWORD).toBe("room-secret");
  expect((await stat(`${s.dir}/settings.json`)).mode & 0o777).toBe(0o600);
  expect(restarted.runtimeEnv().DATA_DIR).toBe(s.dir);
});

test("first-run setup works without room URL or webhook", async () => {
  expect((await store()).configured()).toBe(false);
});

test("secrets are redacted and omitted fields retain their values", async () => {
  const s = await store({ DISCORD_WEBHOOK_URL: hook, CHATZY_PASSWORD: "private" });
  const result = s.publicSettings();
  expect(result.env.DISCORD_WEBHOOK_URL).toBe("");
  expect(result.secretSet.DISCORD_WEBHOOK_URL).toBe(true);
  expect(JSON.stringify(result)).not.toContain("testing-token");
  expect(JSON.stringify(result)).not.toContain("private");
  await s.saveEnv({ CHATZY_ALIAS: "New" });
  expect(s.env.CHATZY_PASSWORD).toBe("private");
  await s.saveEnv({ CHATZY_PASSWORD: "" });
  expect(s.env.CHATZY_PASSWORD).toBe("");
});

test("invalid settings do not change saved settings", async () => {
  const s = await store();
  await expect(s.saveEnv({ UNKNOWN: "1" })).rejects.toThrow(/Unknown/);
  await expect(s.saveEnv({ CHATZY_KEEPALIVE_MIN_MS: "2000000", CHATZY_KEEPALIVE_MAX_MS: "1000000" })).rejects.toThrow(/minimum/);
  await expect(s.saveEnv({ NOVNC_PUBLIC_URL: "javascript:alert(1)" })).rejects.toThrow(/HTTP/);
  await expect(s.saveEnv({ DISCORD_WEBHOOK_URL: "https://example.com" })).rejects.toThrow(/webhook/);
  await expect(s.saveEnv({ COMMAND_PREFIX: "word" })).rejects.toThrow(/Prefix/);
  expect(s.env.CHATZY_KEEPALIVE_MIN_MS).toBe("600000");
});

test("jokes persist and registry sees edits without rebuilding", async () => {
  const s = await store({ JOKE_COOLDOWN_MS: "0" });
  const replies: string[] = [];
  const registry = buildRegistry({ relayFromChatzy: async () => {}, notify: async () => {}, notifyJoin: async () => {} },
    { COMMAND_PREFIX: "?", COMMAND_RELAY: "false" }, () => s.commands);
  await s.saveJokes(["First joke"]);
  await registry.dispatch("a", "?joke", async (t) => { replies.push(t); });
  await s.saveJokes(["Second joke"]);
  await registry.dispatch("a", "?joke", async (t) => { replies.push(t); });
  expect(replies).toEqual(["First joke", "Second joke"]);
  expect(await registry.dispatch("a", "?relay nope", async () => {})).toBe(false);
  const restarted = new SettingsStore(s.dir, {});
  await restarted.load();
  expect(restarted.jokes).toEqual(["Second joke"]);
  await expect(s.saveJokes([""])).rejects.toThrow();
});

test("API persists settings, applies runtime, and rejects cross-origin writes", async () => {
  const s = await store();
  let applied = 0;
  const handler = createWebHandler(s, { status: () => ({ state: "setup" }), apply: async () => { applied++; }, reload: async () => {}, reconnect: async () => {} });
  const req = (origin: string) => new Request("http://localhost/api/settings", {
    method: "PUT", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ CHATZY_ALIAS: "API" }),
  });
  expect((await handler(req("http://evil.test"))).status).toBe(403);
  expect(applied).toBe(0);
  expect((await handler(req("http://localhost"))).status).toBe(200);
  expect(applied).toBe(1);
  expect(s.env.CHATZY_ALIAS).toBe("API");
  expect((await handler(new Request("http://localhost/api/nope"))).status).toBe(404);
});

test("optional Web UI authentication covers settings and controls", async () => {
  const s = await store();
  const handler = createWebHandler(s, { status: () => ({}), apply: async () => {}, reload: async () => {}, reconnect: async () => {} }, "admin-secret");
  expect((await handler(new Request("http://localhost/api/settings"))).status).toBe(401);
  const auth = new Request("http://localhost/api/settings", { headers: { authorization: `Basic ${Buffer.from("admin:admin-secret").toString("base64")}` } });
  expect((await handler(auth)).status).toBe(200);
});

test("HTTPS reverse proxy preserves same-host origin checks", async () => {
  const s = await store();
  const handler = createWebHandler(s, { status: () => ({}), apply: async () => {}, reload: async () => {}, reconnect: async () => {} });
  const request = (origin: string) => new Request("http://bot.example/api/jokes", {
    method: "PUT", headers: { origin, "x-forwarded-proto": "https", "content-type": "application/json" },
    body: JSON.stringify(["Joke through the proxy"]),
  });
  expect((await handler(request("https://bot.example"))).status).toBe(200);
  expect((await handler(request("https://other.example"))).status).toBe(403);
});
