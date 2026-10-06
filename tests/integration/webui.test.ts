import { expect, test } from "bun:test";
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { SettingsStore } from "../../src/settings.ts";
import { createWebHandler } from "../../src/web/server.ts";

// Run `bun run build:web` first. CI builds these assets before running tests.
test("SolidJS UI edits settings and custom selectors, handles secrets, and survives reload", async () => {
  if (!(await Bun.file("web/dist/index.html").exists())) {
    throw new Error("Build the UI before integration tests: bun run build:web");
  }
  const dir = await mkdtemp("/tmp/chatzy-webui-test-");
  const store = new SettingsStore(dir, { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/secret-token" });
  await store.load();
  let applies = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createWebHandler(store, {
    status: () => ({ configured: store.configured(), applying: false, error: null, novncUrl: store.env.NOVNC_PUBLIC_URL, configDir: dir, chatzy: null, discord: null }),
    apply: async () => { applies++; }, reload: async () => {}, reconnect: async () => {},
  }) });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.getByLabel("Room URL", { exact: true }).fill("https://us28.chatzy.com/1");
    expect(await page.getByLabel("Relay webhook URL", { exact: true }).inputValue()).toBe("");
    await page.getByLabel("Bot alias", { exact: true }).fill("UI Bot");
    await page.getByLabel("Public VNC URL", { exact: true }).fill("http://localhost:6080/vnc.html");
    await page.getByRole("button", { name: "Save & apply" }).click();
    await page.getByRole("status").filter({ hasText: "Settings saved" }).waitFor();
    expect(applies).toBe(1);
    expect(store.env.DISCORD_WEBHOOK_URL).toContain("secret-token");
    expect(await page.getByRole("link", { name: "Open browser" }).getAttribute("href")).toBe("http://localhost:6080/vnc.html");
    await page.locator(".command-card summary").filter({ hasText: "!joke" }).click();
    await page.locator("#values-joke").fill("A joke edited in SolidJS.\nSecond joke.");
    await page.getByRole("button", { name: "Save commands", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Custom commands saved" }).waitFor();
    expect(store.jokes).toEqual(["A joke edited in SolidJS.", "Second joke."]);
    await page.getByRole("button", { name: "+ Add random selector" }).click();
    const card = page.locator(".command-card").last();
    await card.getByRole("textbox", { name: /Command name/ }).fill("jenna");
    await card.getByLabel("Responses (one per line)", { exact: true }).fill("https://example.com/one.jpg\n\nhttps://example.com/two.gif\n");
    await page.getByRole("button", { name: "Save commands", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Custom commands saved" }).waitFor();
    expect(store.commands.find((c) => c.name === "jenna")?.values).toEqual(["https://example.com/one.jpg", "https://example.com/two.gif"]);
    expect(applies).toBe(1); // Editing selectors never restarts the session.
    await page.reload();
    await page.getByLabel("Bot alias", { exact: true }).waitFor();
    expect(await page.getByLabel("Bot alias", { exact: true }).inputValue()).toBe("UI Bot");
    await page.locator(".command-card summary").filter({ hasText: "!joke" }).click();
    expect(await page.locator("#values-joke").inputValue()).toBe("A joke edited in SolidJS.\nSecond joke.");
    const jenna = page.locator(".command-card").filter({ has: page.locator("summary", { hasText: "!jenna" }) });
    await jenna.locator("summary").click();
    await jenna.getByLabel("Enabled", { exact: true }).uncheck();
    await page.getByRole("button", { name: "Save commands", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Custom commands saved" }).waitFor();
    expect(store.commands.find((c) => c.name === "jenna")?.enabled).toBe(false);
    await jenna.getByRole("button", { name: "Remove command" }).click();
    await page.getByRole("button", { name: "Save commands", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Custom commands saved" }).waitFor();
    expect(store.commands.map((c) => c.name)).toEqual(["joke"]);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);
