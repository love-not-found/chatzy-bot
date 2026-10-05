import { describe, expect, test } from "bun:test";
import { createJokePicker, helpCommand, jokeCommand, relayCommand } from "../../src/commands/builtin.ts";
import { CommandRegistry, parseCommand } from "../../src/commands/registry.ts";
import { createHandlers } from "../../src/coordinator.ts";

describe("parseCommand", () => {
  test("parses name and args", () => {
    expect(parseCommand("!Relay  hello world ")).toEqual({ name: "relay", args: "hello world" });
    expect(parseCommand("!joke")).toEqual({ name: "joke", args: "" });
  });
  test("ignores non-commands", () => {
    expect(parseCommand("hello !joke")).toBeNull();
    expect(parseCommand("! joke")).toBeNull();
    expect(parseCommand("!")).toBeNull();
  });
});

function setup() {
  const relayed: [string, string][] = [];
  const replies: string[] = [];
  const reg = new CommandRegistry();
  reg.register(helpCommand(reg));
  reg.register(jokeCommand(() => "a joke"));
  reg.register(
    relayCommand(async (u, t) => {
      relayed.push([u, t]);
    }),
  );
  const reply = async (t: string) => void replies.push(t);
  return { reg, relayed, replies, reply };
}

describe("registry", () => {
  test("!joke replies", async () => {
    const { reg, replies, reply } = setup();
    expect(await reg.dispatch("nora", "!joke", reply, 0)).toBe(true);
    expect(replies).toEqual(["a joke"]);
  });

  test("!relay forwards and does not reply on success", async () => {
    const { reg, relayed, replies, reply } = setup();
    await reg.dispatch("Amour (26)", "!relay hi there", reply, 0);
    expect(relayed).toEqual([["Amour (26)", "hi there"]]);
    expect(replies).toEqual([]);
  });

  test("!relay without text shows usage", async () => {
    const { reg, relayed, replies, reply } = setup();
    await reg.dispatch("nora", "!relay", reply, 0);
    expect(relayed).toEqual([]);
    expect(replies[0]).toContain("Usage");
  });

  test("per-user cooldown", async () => {
    const { reg, replies, reply } = setup();
    await reg.dispatch("nora", "!joke", reply, 0);
    await reg.dispatch("nora", "!joke", reply, 1000);
    await reg.dispatch("amy", "!joke", reply, 1000);
    await reg.dispatch("nora", "!joke", reply, 6000);
    expect(replies.length).toBe(3);
  });

  test("unknown commands are ignored", async () => {
    const { reg, replies, reply } = setup();
    expect(await reg.dispatch("nora", "!nope", reply, 0)).toBe(false);
    expect(replies).toEqual([]);
  });

  test("!help lists commands", async () => {
    const { reg, replies, reply } = setup();
    await reg.dispatch("nora", "!help", reply, 0);
    expect(replies[0]).toContain("!relay <message>");
  });
});

test("joke picker avoids immediate repeats", () => {
  const pick = createJokePicker(["a", "b"], () => 0);
  expect([pick(), pick(), pick()]).toEqual(["a", "b", "a"]);
});

test("bot never reacts to its own messages", async () => {
  const sent: string[] = [];
  const relayed: string[] = [];
  const handlers = createHandlers(
    () => ({ isSelf: (n) => n === "Room Bot", send: async (t) => void sent.push(t) }),
    {
      relayFromChatzy: async (_u, t) => void relayed.push(t),
      notifyJoin: async () => {},
      notify: async () => {},
    },
  );
  handlers.onEvent!({ type: "message", user: "Room Bot", text: "!relay loop", links: [], images: [] });
  handlers.onEvent!({ type: "message", user: "nora", text: "!relay ok", links: [], images: [] });
  await Bun.sleep(10);
  expect(relayed).toEqual(["ok"]);
});
