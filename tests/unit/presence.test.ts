import { expect, test } from "bun:test";
import { JoinDetector } from "../../src/chatzy/presence.ts";

const SELF = "Room Bot";
const make = () => new JoinDetector((n) => n === SELF, 60_000);

test("first snapshot is a silent baseline", () => {
  const d = make();
  expect(d.onSnapshot([SELF, "a", "b"], 0)).toEqual([]);
  expect(d.onSnapshot([SELF, "a", "b", "c"], 1000)).toEqual(["c"]);
});

test("a list without the bot is still loading and is ignored", () => {
  const d = make();
  expect(d.onSnapshot([], 0)).toEqual([]);
  expect(d.ready).toBe(false);
  expect(d.onSnapshot([SELF, "a"], 1000)).toEqual([]);
  expect(d.ready).toBe(true);
  expect(d.onSnapshot(["a", "b"], 2000)).toEqual([]);
  expect(d.onSnapshot([SELF, "a", "b"], 3000)).toEqual(["b"]);
});

test("join line and later snapshot are deduplicated", () => {
  const d = make();
  d.onSnapshot([SELF, "a"], 0);
  expect(d.onJoinLine("b", 1000)).toBe(true);
  expect(d.onSnapshot([SELF, "a", "b"], 5000)).toEqual([]);
});

test("snapshot first, then join line, is deduplicated", () => {
  const d = make();
  d.onSnapshot([SELF], 0);
  expect(d.onSnapshot([SELF, "b"], 1000)).toEqual(["b"]);
  expect(d.onJoinLine("b", 2000)).toBe(false);
});

test("rejoin after the window notifies again", () => {
  const d = make();
  d.onSnapshot([SELF], 0);
  expect(d.onJoinLine("b", 1000)).toBe(true);
  d.onLeaveLine("b");
  expect(d.onJoinLine("b", 120_000)).toBe(true);
});

test("own alias never notifies", () => {
  const d = make();
  d.onSnapshot([SELF], 0);
  expect(d.onJoinLine(SELF, 1000)).toBe(false);
});

test("reset makes the next snapshot a baseline again", () => {
  const d = make();
  d.onSnapshot([SELF, "a"], 0);
  d.reset();
  expect(d.onSnapshot([SELF, "a", "x", "y"], 1000)).toEqual([]);
});
