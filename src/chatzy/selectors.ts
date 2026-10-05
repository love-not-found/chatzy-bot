/**
 * Every Chatzy DOM hook lives here.
 *
 * The `#X....` IDs come from Chatzy's obfuscated frontend build and may change
 * when Chatzy deploys. Each entry lists candidates in priority order: the
 * observed ID first, then structural fallbacks. The first candidate that
 * matches in the page wins.
 */
export const selectors = {
  /** Container whose direct <p> children are chat/system lines. */
  messageLog: ["#X2803", "td:has(> p.a)", "td:has(> p.b)"],
  /** Text input used to send messages. */
  messageInput: ["#X9225", 'form input[type="text"][maxlength="4000"]'],
  /** Visitor list: <h3>N Online</h3>, online <p title>, a <div> divider, then recent offline users. */
  visitorList: ["#X5592", "div:has(> h3 + p[title])"],
  /** Shows "Connected" while the room socket is healthy. */
  connectionStatus: ["#X7483"],
  /** "Leave Room" menu entry (equivalent to /bye). */
  leaveRoom: ["#X7397", 'a[title^="Leave the room"]'],
  /** The bot's own alias as shown next to the input field. */
  ownAlias: ["#X6807 b", 'form a[title^="Click to change your alias"] b'],
  /** Entry/join page: password field for Premium rooms. */
  entryPassword: ['input[type="password"]'],
  /** Entry/join page form: alias text input, color select, submit button. */
  entryForm: ["#X8823", 'form:has(input[type="submit"]):has(input[type="text"])'],
} as const;

export type SelectorKey = keyof typeof selectors;
export type SelectorMap = Record<SelectorKey, readonly string[]>;

/** Hooks without which the bot cannot function in the room. */
export const requiredInRoom: SelectorKey[] = ["messageLog", "messageInput"];
/** Hooks that degrade features if missing. */
export const optionalInRoom: SelectorKey[] = ["visitorList", "connectionStatus", "leaveRoom", "ownAlias"];

/** Class tokens on message-log lines. */
export const lineClasses = { chat: "a", system: "b" } as const;
