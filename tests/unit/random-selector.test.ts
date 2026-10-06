import { expect, test } from "bun:test";
import { createRandomPicker, customCommandsSchema, parseSelectorLines, type RandomSelector } from "../../src/commands/random-selector.ts";
import { buildRegistry } from "../../src/coordinator.ts";

function command(overrides: Partial<RandomSelector> = {}): RandomSelector {
  return { id: "custom-jenna", category: "random-selector", name: "jenna", description: "random image", enabled: true, cooldownMs: 1000, avoidRepeats: true, values: ["https://example.com/one.jpg", "https://example.com/two.gif"], ...overrides };
}

test("line-separated responses trim whitespace, skip blanks, and preserve URLs", () => {
  expect(parseSelectorLines(" First joke \r\n\r\n https://example.com/a_b.jpg?x=1&y=2 \r\nSecond joke\n")).toEqual([
    "First joke", "https://example.com/a_b.jpg?x=1&y=2", "Second joke",
  ]);
});

test("selection excludes the previous value without treating links differently", () => {
  const values = command().values;
  const pick = createRandomPicker(() => values, () => 0);
  expect([pick(), pick(), pick()]).toEqual([values[0], values[1], values[0]]);
  const allow = createRandomPicker(() => values, () => 0, () => false);
  expect([allow(), allow()]).toEqual([values[0], values[0]]);
});

test("single-valued and empty lists are handled", () => {
  const pick = createRandomPicker(() => ["one"], () => 0);
  expect([pick(), pick()]).toEqual(["one", "one"]);
  expect(createRandomPicker(() => [])()).toBeUndefined();
  // Duplicate entries must not cause repeats if a different value is available.
  const duplicates = createRandomPicker(() => ["a", "a", "b"], () => 0);
  expect([duplicates(), duplicates(), duplicates()]).toEqual(["a", "b", "a"]);
});

test("custom names normalize and cannot collide with built-ins or each other", () => {
  expect(customCommandsSchema.parse([command({ name: " JENNA " })])[0]!.name).toBe("jenna");
  expect(() => customCommandsSchema.parse([command({ name: "!jenna" })])).toThrow(/no prefix/);
  expect(() => customCommandsSchema.parse([command({ name: "Help" })])).toThrow(/reserved/);
  expect(() => customCommandsSchema.parse([command(), command({ id: "other", name: "JENNA" })])).toThrow(/unique/);
  expect(() => customCommandsSchema.parse([command(), command({ name: "other" })])).toThrow(/IDs/);
  expect(() => customCommandsSchema.parse([command({ cooldownMs: -1 })])).toThrow();
  expect(() => customCommandsSchema.parse([command({ values: ["two\nlines"] })])).toThrow(/single line/);
});

const outlet = { relayFromChatzy: async () => {}, notify: async () => {}, notifyJoin: async () => {} };

test("registry reads additions, edits, disabling, renaming, deletion and help live", async () => {
  let commands: RandomSelector[] = [];
  const registry = buildRegistry(outlet, { COMMAND_PREFIX: "?" }, () => commands);
  const replies: string[] = [];
  const reply = async (value: string) => { replies.push(value); };
  expect(await registry.dispatch("a", "?jenna", reply, 0)).toBe(false);
  commands = [command({ values: ["first"], cooldownMs: 0 })];
  await registry.dispatch("a", "?JENNA", reply, 1);
  commands = [command({ values: ["edited"], cooldownMs: 0 })];
  await registry.dispatch("a", "?jenna", reply, 2);
  expect(replies).toEqual(["first", "edited"]);
  commands = [command({ enabled: false })];
  expect(await registry.dispatch("a", "?jenna", reply, 3)).toBe(false);
  commands = [command({ name: "images", values: ["renamed"] })];
  expect(await registry.dispatch("a", "?jenna", reply, 4)).toBe(false);
  await registry.dispatch("a", "?images", reply, 5);
  await registry.dispatch("a", "?help", reply, 6);
  expect(replies[2]).toBe("renamed");
  expect(replies[3]).toContain("?images");
  expect(replies[3]).not.toContain("?jenna");
  commands = [];
  expect(await registry.dispatch("a", "?images", reply, 7)).toBe(false);
});

test("each custom command has its own per-user cooldown", async () => {
  const registry = buildRegistry(outlet, {}, () => [command({ values: ["image"] }), command({ id: "joke", name: "joke", values: ["joke"] })]);
  const replies: string[] = [];
  const reply = async (value: string) => { replies.push(value); };
  await registry.dispatch("a", "!jenna", reply, 0);
  await registry.dispatch("a", "!jenna", reply, 100);
  await registry.dispatch("a", "!joke", reply, 100);
  await registry.dispatch("b", "!jenna", reply, 100);
  await registry.dispatch("a", "!jenna", reply, 1000);
  expect(replies).toEqual(["image", "joke", "image", "image"]);
});

test("empty selector responds with an actionable message", async () => {
  const registry = buildRegistry(outlet, {}, () => [command({ values: [] })]);
  let response = "";
  await registry.dispatch("a", "!jenna", async (value) => { response = value; });
  expect(response).toBe("No values configured for !jenna.");
});
