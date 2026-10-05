import { expect, test } from "bun:test";
import { DiscordWebhook, webhookUsername } from "../../src/discord/webhook.ts";
import { createWebhookOutlet } from "../../src/discord/outlet.ts";

const HOOK = "https://discord.com/api/webhooks/123/abc";

function fakeFetch(responses: (() => Response)[]) {
  const calls: { url: string; body: any }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return next();
  };
  return { fn, calls };
}

const ok = () => new Response("{}", { status: 200 });
const noSleep = async () => {};

test("posts with mentions disabled and wait=true", async () => {
  const f = fakeFetch([ok]);
  await new DiscordWebhook(HOOK, "Chatzy Bot", f.fn, noSleep).send({ content: "@everyone hi" });
  expect(f.calls[0]!.url).toBe(`${HOOK}?wait=true`);
  expect(f.calls[0]!.body).toEqual({
    content: "@everyone hi",
    username: "Chatzy Bot",
    allowed_mentions: { parse: [] },
  });
});

test("retries after a 429 using retry_after", async () => {
  const slept: number[] = [];
  const f = fakeFetch([() => Response.json({ retry_after: 0.25 }, { status: 429 }), ok]);
  await new DiscordWebhook(HOOK, "x", f.fn, async (ms) => void slept.push(ms)).send({ content: "a" });
  expect(f.calls.length).toBe(2);
  expect(slept).toEqual([500]);
});

test("does not retry a 404 and reports the error", async () => {
  const f = fakeFetch([() => new Response('{"message":"Unknown Webhook"}', { status: 404 })]);
  const hook = new DiscordWebhook(HOOK, "x", f.fn, noSleep);
  await expect(hook.send({ content: "a" })).rejects.toThrow(/404/);
  expect(hook.lastError).toContain("Unknown Webhook");
});

test("gives up after repeated 5xx", async () => {
  const err = () => new Response("", { status: 502 });
  const f = fakeFetch([err, err, err, err]);
  await expect(new DiscordWebhook(HOOK, "x", f.fn, noSleep).send({ content: "a" })).rejects.toThrow(/502/);
  expect(f.calls.length).toBe(4);
});

test("messages are delivered in order", async () => {
  const f = fakeFetch([ok, ok, ok]);
  const hook = new DiscordWebhook(HOOK, "x", f.fn, noSleep);
  await Promise.all(["1", "2", "3"].map((c) => hook.send({ content: c })));
  expect(f.calls.map((c) => c.body.content)).toEqual(["1", "2", "3"]);
});

test("rejects non-webhook URLs", () => {
  expect(() => new DiscordWebhook("https://evil.example/api/webhooks/1/x", "x")).toThrow();
});

test("webhookUsername avoids names Discord rejects", () => {
  expect(webhookUsername("Discord fan")).toBe("D_iscord fan");
  expect(webhookUsername("clyde")).toBe("c_lyde");
  expect(webhookUsername("  everyone ")).toBe("Chatzy");
  expect(webhookUsername("x".repeat(100)).length).toBe(80);
});

test("outlet formats relays and join notices", async () => {
  const f = fakeFetch([ok, ok]);
  const outlet = createWebhookOutlet(
    { relayWebhookUrl: HOOK, notifyWebhookUrl: HOOK, webhookName: "Chatzy Bot" },
    f.fn as unknown as typeof fetch,
  );
  await outlet.relayFromChatzy("Amour (26)", "hi *there*");
  await outlet.notifyJoin("nora_x");
  expect(f.calls.map((c) => [c.body.username, c.body.content])).toEqual([
    ["Amour (26) (Chatzy)", "hi *there*"],
    ["Chatzy Bot", "*nora\\_x joined the Chatzy room.*"],
  ]);
});
