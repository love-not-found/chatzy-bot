/**
 * Runs the in-page scripts against a sanitized fixture in real (headless) Chromium.
 * Requires Playwright browsers (provided by `nix develop`).
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";
import { classifyPage, onlineFromVisitorList, parseLine } from "../../src/chatzy/parser.ts";
import { BINDING_NAME, installObserver, probePage, readVisitorList } from "../../src/chatzy/page-scripts.ts";
import { selectors } from "../../src/chatzy/selectors.ts";
import type { RawLine } from "../../src/chatzy/types.ts";

const fixture = await Bun.file(new URL("../fixtures/room.html", import.meta.url)).text();
let browser: Browser;
let page: Page;
const lines: RawLine[] = [];

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.exposeFunction(BINDING_NAME, (l: RawLine) => void lines.push(l));
  await page.setContent(fixture);
});
afterAll(async () => {
  await browser?.close();
});

test("probe classifies the fixture as a connected room", async () => {
  const p = await page.evaluate(probePage, selectors);
  expect(classifyPage(p)).toBe("room-connected");
  expect(p.ownAlias).toBe("Room Bot");
  expect(p.observerInstalled).toBe(false);
  expect(p.found.leaveRoom).toBe(true);
});

test("inactivity prompt is detected only while visible and can be dismissed", async () => {
  expect((await page.evaluate(probePage, selectors)).awayPromptVisible).toBe(false);
  await page.evaluate(() => (document.getElementById("X6924")!.style.display = "block"));
  const shown = await page.evaluate(probePage, selectors);
  expect(shown.awayPromptVisible).toBe(true);
  expect(classifyPage(shown)).toBe("room-connected");

  await page.locator(`${selectors.awayPrompt.join(", ")} >> visible=true`).first().click();
  expect(await page.evaluate(() => (window as any).__here)).toBe(1);
  expect((await page.evaluate(probePage, selectors)).awayPromptVisible).toBe(false);
});

test("keep-alive selectors open and close My Messages", async () => {
  await page.locator(selectors.myMessages.join(", ")).first().click();
  const close = page.locator(`${selectors.dialog.join(", ")} input[type="button"] >> visible=true`).first();
  await close.click();
  expect(await page.evaluate(() => (window as any).__activity)).toBe(1);
  expect(await page.locator(selectors.dialog.join(", ")).isVisible()).toBe(false);
});

test("visitor list", async () => {
  const entries = await page.evaluate(readVisitorList, selectors.visitorList);
  expect(onlineFromVisitorList(entries!)).toEqual(["Amour (26)"]);
});

test("observer ignores history and reports new lines", async () => {
  const ok = await page.evaluate(installObserver, { messageLog: selectors.messageLog, settleMs: 0, binding: BINDING_NAME });
  expect(ok).toBe(true);
  expect((await page.evaluate(probePage, selectors)).observerInstalled).toBe(true);

  await page.evaluate(() => {
    const log = document.getElementById("X2803")!;
    log.insertAdjacentHTML("beforeend", '<p class="b"><b class="X7409">nora</b> joined the chat</p>');
    log.insertAdjacentHTML("beforeend", '<p class="a"><b class="X7409">nora</b>: !relay hello <a href="https://example.com/x">link</a></p>');
  });
  // Send through the real input the way the session does.
  await page.locator(selectors.messageInput.join(", ")).first().fill("from bot");
  await page.locator(selectors.messageInput.join(", ")).first().press("Enter");
  await page.waitForTimeout(200);

  const events = lines.map(parseLine);
  expect(events).toEqual([
    { type: "join", user: "nora" },
    { type: "message", user: "nora", text: "!relay hello link", links: ["https://example.com/x"], images: [] },
    { type: "message", user: "Room Bot", text: "from bot", links: [], images: [] },
  ]);
});

test("reinstalling does not replay lines", async () => {
  const before = lines.length;
  await page.evaluate(installObserver, { messageLog: selectors.messageLog, settleMs: 0, binding: BINDING_NAME });
  await page.waitForTimeout(100);
  expect(lines.length).toBe(before);
});
