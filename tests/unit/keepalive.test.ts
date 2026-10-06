import { expect, test } from "bun:test";
import { nextKeepaliveDelay } from "../../src/chatzy/keepalive.ts";
import { loadChatzyConfig } from "../../src/config.ts";

const MIN = 10 * 60_000;
const MAX = 25 * 60_000;

test("keep-alive delay is random within bounds", () => {
  expect(nextKeepaliveDelay(MIN, MAX, () => 0)).toBe(MIN);
  expect(nextKeepaliveDelay(MIN, MAX, () => 0.999999)).toBeLessThanOrEqual(MAX);
  expect(nextKeepaliveDelay(MIN, MAX, () => 0.5)).toBe((MIN + MAX) / 2);
  const samples = new Set(Array.from({ length: 50 }, () => nextKeepaliveDelay(MIN, MAX)));
  expect(samples.size).toBeGreaterThan(40); // irregular, not a fixed period
  for (const s of samples) expect(s >= MIN && s <= MAX).toBe(true);
});

test("swapped bounds are tolerated", () => {
  expect(nextKeepaliveDelay(MAX, MIN, () => 0)).toBe(MIN);
});

test("keep-alive config defaults and limits", () => {
  const base = { CHATZY_ROOM_URL: "https://us28.chatzy.com/1" };
  expect(loadChatzyConfig(base).keepalive).toEqual({ enabled: true, minMs: MIN, maxMs: MAX });
  expect(loadChatzyConfig({ ...base, CHATZY_KEEPALIVE: "false" }).keepalive.enabled).toBe(false);
  expect(() => loadChatzyConfig({ ...base, CHATZY_KEEPALIVE_MAX_MS: String(60 * 60_000) })).toThrow(/60-minute/);
  expect(() => loadChatzyConfig({ ...base, CHATZY_KEEPALIVE_MIN_MS: "1000" })).toThrow(/60000/);
});
