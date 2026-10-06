import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { RandomSelector } from "../../src/commands/random-selector.ts";
import { SettingsStore } from "../../src/settings.ts";
import { createWebHandler } from "../../src/web/server.ts";

function command(overrides: Partial<RandomSelector> = {}): RandomSelector {
  return { id: "custom-jenna", category: "random-selector", name: "jenna", description: "random image", enabled: true, cooldownMs: 1000, avoidRepeats: true, values: ["https://example.com/one.jpg", "https://example.com/two.gif"], ...overrides };
}

const dirs: string[] = [];
async function directory() {
  const dir = await mkdtemp("/tmp/chatzy-selectors-test-");
  dirs.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

test("existing jokes migrate once with their enabled state and cooldown intact", async () => {
  const dir = await directory();
  await writeFile(`${dir}/jokes.json`, JSON.stringify(["My saved joke", "Another\nline"]));
  await writeFile(`${dir}/settings.json`, JSON.stringify({ version: 1, env: { COMMAND_JOKE: "false", JOKE_COOLDOWN_MS: "8000" } }));
  const store = new SettingsStore(dir, {});
  await store.load();
  expect(store.commands).toEqual([command({ id: "joke", name: "joke", description: "tell a joke", enabled: false, cooldownMs: 8000, values: ["My saved joke", "Another line"] })]);
  expect(JSON.parse(await readFile(`${dir}/jokes.json`, "utf8"))).toEqual(["My saved joke", "Another\nline"]);
  await store.saveCommands([]);
  const restarted = new SettingsStore(dir, {});
  await restarted.load();
  expect(restarted.commands).toEqual([]); // Deleted joke must not reappear from migration.
});

test("saved custom commands persist; invalid changes leave disk and live state intact", async () => {
  const dir = await directory();
  const store = new SettingsStore(dir, {});
  await store.load();
  await store.saveCommands([command()]);
  await expect(store.saveCommands([command({ name: "relay" })])).rejects.toThrow(/reserved/);
  const restarted = new SettingsStore(dir, {});
  await restarted.load();
  expect(restarted.commands).toEqual([command()]);
  expect(store.commands).toEqual([command()]);
});

test("commands API saves immediately without calling runtime apply", async () => {
  const dir = await directory();
  const store = new SettingsStore(dir, {});
  await store.load();
  let applies = 0;
  const handler = createWebHandler(store, { status: () => ({}), apply: async () => { applies++; }, reload: async () => {}, reconnect: async () => {} });
  const request = (value: unknown, origin = "http://localhost") => new Request("http://localhost/api/commands", {
    method: "PUT", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value),
  });
  expect((await handler(request([command()], "http://other.test"))).status).toBe(403);
  expect((await handler(request([command()]))).status).toBe(200);
  expect((await handler(request([command({ name: "help" })]))).status).toBe(400);
  expect(await (await handler(new Request("http://localhost/api/commands"))).json()).toEqual([command()]);
  expect(applies).toBe(0);
});
