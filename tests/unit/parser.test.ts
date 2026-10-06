import { describe, expect, test } from "bun:test";
import { classifyPage, onlineFromVisitorList, parseLine } from "../../src/chatzy/parser.ts";
import type { PageProbe, RawLine } from "../../src/chatzy/types.ts";

const line = (classes: string[], author: string | null, text: string): RawLine => ({
  classes,
  author,
  text,
  links: [],
  images: [],
});

describe("parseLine", () => {
  test("chat message with spaces and parentheses in the name", () => {
    expect(parseLine(line(["a"], "Amour (26)", "Amour (26): this is a test message"))).toEqual({
      type: "message",
      user: "Amour (26)",
      text: "this is a test message",
      links: [],
      images: [],
    });
  });

  test("message body keeps later colons", () => {
    const ev = parseLine(line(["a"], "nora", "nora: time: 10:30"));
    expect(ev).toMatchObject({ type: "message", text: "time: 10:30" });
  });

  test("join line", () => {
    expect(parseLine(line(["b"], "Amour (26)", "Amour (26) joined the chat "))).toEqual({
      type: "join",
      user: "Amour (26)",
    });
  });

  test("join line with age suffix from history", () => {
    expect(parseLine(line(["b"], "Room Bot", "Room Bot joined the chat 2 minutes ago"))).toEqual({
      type: "join",
      user: "Room Bot",
    });
  });

  test("leave line", () => {
    expect(parseLine(line(["b"], "nora", "nora left the chat"))).toEqual({ type: "leave", user: "nora" });
  });

  test("other system lines", () => {
    expect(parseLine(line(["b"], "nora", "nora started the chat 69 seconds ago"))).toEqual({
      type: "system",
      text: "nora started the chat 69 seconds ago",
    });
    expect(parseLine(line(["x"], null, "  something\n else "))).toEqual({ type: "system", text: "something else" });
  });
});

describe("classifyPage", () => {
  const probe = (found: Record<string, boolean>, statusText: string | null): PageProbe => ({
    url: "https://example.test/room",
    title: "",
    found,
    statusText,
    ownAlias: null,
    observerInstalled: false,
    awayPromptVisible: false,
    bodyText: null,
  });

  test("connected room", () => {
    expect(classifyPage(probe({ messageLog: true, messageInput: true }, "Connected"))).toBe("room-connected");
    expect(classifyPage(probe({ messageLog: true, messageInput: true }, "Updated 30 seconds ago"))).toBe(
      "room-connected",
    );
  });
  test("room UI present but socket down", () => {
    expect(classifyPage(probe({ messageLog: true, messageInput: true }, "Reconnecting..."))).toBe("room-disconnected");
  });
  test("missing status element trusts room UI", () => {
    expect(classifyPage(probe({ messageLog: true, messageInput: true }, null))).toBe("room-connected");
  });
  test("entry page", () => {
    expect(classifyPage(probe({ entryPassword: true }, null))).toBe("entry");
    expect(classifyPage(probe({ entryForm: true }, null))).toBe("entry");
  });
  test("inactivity prompt does not count as disconnected", () => {
    const p = { ...probe({ messageLog: true, messageInput: true }, "Connected"), awayPromptVisible: true };
    expect(classifyPage(p)).toBe("room-connected");
  });
  test("anything else", () => {
    expect(classifyPage(probe({}, null))).toBe("unknown");
  });
});

test("onlineFromVisitorList stops at divider", () => {
  expect(
    onlineFromVisitorList([
      { tag: "P", name: "Amour (26)" },
      { tag: "P", name: "Room Bot" },
      { tag: "DIV", name: "" },
      { tag: "P", name: "nora" },
    ]),
  ).toEqual(["Amour (26)", "Room Bot"]);
});
