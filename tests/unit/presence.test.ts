import { expect, test } from "bun:test";
import { JoinDetector } from "../../src/chatzy/presence.ts";

const SELF = "Room Bot";
const make = () => new JoinDetector((n) => n === SELF, 60_000);

test("visitor-list changes only refresh presence, never produce join notifications", () => {
  const d = make();
  expect(d.onSnapshot([SELF, "a"])).toBeUndefined();
  expect(d.onSnapshot([SELF, "a", "b"])).toBeUndefined();
  expect(d.onlineUsers).toEqual([SELF, "a", "b"]);
  // List refresh must not claim a notification or suppress a subsequent chat join.
  expect(d.onJoinLine("b", 1000)).toBe(true);
});

test("a list without the bot is still loading and is ignored", () => {
  const d = make();
  d.onSnapshot([]);
  expect(d.ready).toBe(false);
  d.onSnapshot([SELF, "a"]);
  expect(d.ready).toBe(true);
  d.onSnapshot(["a", "b"]);
  expect(d.onlineUsers).toEqual([SELF, "a"]);
});

test("repeated chat join lines are deduplicated even after a list refresh", () => {
  const d = make();
  expect(d.onJoinLine("b", 1000)).toBe(true);
  d.onSnapshot([SELF, "b"]);
  expect(d.onJoinLine("b", 2000)).toBe(false);
});

test("rejoin after the window notifies again", () => {
  const d = make();
  expect(d.onJoinLine("b", 1000)).toBe(true);
  d.onLeaveLine("b");
  expect(d.onJoinLine("b", 120_000)).toBe(true);
});

test("own alias never notifies", () => {
  expect(make().onJoinLine(SELF, 1000)).toBe(false);
});

test("reset clears presence without clearing recent join deduplication", () => {
  const d = make();
  d.onSnapshot([SELF, "a"]);
  d.onJoinLine("b", 1000);
  d.reset();
  expect(d.ready).toBe(false);
  expect(d.onlineUsers).toEqual([]);
  d.onSnapshot([SELF, "a", "x", "y"]);
  expect(d.onlineUsers).toEqual([SELF, "a", "x", "y"]);
  expect(d.onJoinLine("b", 2000)).toBe(false);
});
