import { expect, test } from "bun:test";
import { RecoveryWindow } from "../../src/chatzy/recovery.ts";
import { createHandlers } from "../../src/coordinator.ts";

test("five retries within two minutes, alert only after both limits are reached", () => {
  const recovery = new RecoveryWindow(120_000, 5);
  recovery.start(0);
  expect(recovery.takeRetry(3_000)).toBe(false);
  for (const t of [12_000, 36_000, 60_000, 84_000, 108_000]) {
    expect(recovery.takeRetry(t)).toBe(true);
    expect(recovery.failed(t)).toBe(false);
  }
  expect(recovery.failed(119_999)).toBe(false);
  expect(recovery.failed(120_000)).toBe(true);
  expect(recovery.takeRetry(150_000)).toBe(false);
});

test("slow retries must exhaust their budget before alerting", () => {
  const recovery = new RecoveryWindow(120_000, 5);
  recovery.start(0);
  recovery.takeRetry(12_000);
  expect(recovery.failed(120_000)).toBe(false);
});

test("recovery resets the continuous outage window", () => {
  const recovery = new RecoveryWindow(120_000, 5);
  recovery.start(0);
  recovery.takeRetry(12_000);
  recovery.reset();
  recovery.start(200_000);
  expect(recovery.attempts).toBe(0);
  expect(recovery.failed(200_000)).toBe(false);
  expect(recovery.takeRetry(203_000)).toBe(false);
});

test("brief outages are silent, recovery notice follows an announced failure only", () => {
  const notices: string[] = [];
  const handlers = createHandlers(
    () => ({ isSelf: () => false, send: async () => {} }),
    {
      relayFromChatzy: async () => {},
      notifyJoin: async () => {},
      notify: async (text) => { notices.push(text); },
    },
  );
  handlers.onStateChange!("connected", "joining");
  handlers.onStateChange!("disconnected", "connected");
  handlers.onStateChange!("connected", "disconnected");
  expect(notices).toEqual(["Chatzy bot is connected to the room."]);
  handlers.onStateChange!("waiting_for_operator", "reconnecting", "retry window exhausted");
  handlers.onStateChange!("connected", "waiting_for_operator");
  expect(notices.length).toBe(3);
  expect(notices[1]).toContain("retry window exhausted");
  expect(notices[2]).toBe("Chatzy connection restored.");
});
