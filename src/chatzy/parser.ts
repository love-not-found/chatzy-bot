import { lineClasses } from "./selectors.ts";
import type { ChatzyEvent, PageKind, PageProbe, RawLine } from "./types.ts";

const JOIN_RE = /^(?:has\s+)?joined\b/i;
const LEAVE_RE = /^(?:has\s+)?(?:left|exited)\b/i;
const DISCONNECTED_RE = /disconnect|reconnect|connecting|lost|offline|error|fail|timed? ?out|unable/i;

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Turn a raw <p> from the message log into a typed event. */
export function parseLine(line: RawLine): ChatzyEvent {
  const text = collapse(line.text);
  const author = line.author ? collapse(line.author) : null;

  if (author && line.classes.includes(lineClasses.chat) && text.startsWith(author)) {
    const body = text.slice(author.length).replace(/^:\s?/, "");
    return { type: "message", user: author, text: body, links: line.links, images: line.images };
  }

  if (author && line.classes.includes(lineClasses.system) && text.startsWith(author)) {
    const rest = text.slice(author.length).trim();
    if (JOIN_RE.test(rest)) return { type: "join", user: author };
    if (LEAVE_RE.test(rest)) return { type: "leave", user: author };
  }

  return { type: "system", text };
}

/** Classify the page from a probe. */
export function classifyPage(p: PageProbe): PageKind {
  const inRoom = p.found.messageLog && p.found.messageInput;
  if (inRoom) {
    // Observed healthy texts: "Connected", "Updated 30 seconds ago". Only explicit
    // failure wording counts as disconnected; a missing element trusts the room UI.
    if (p.statusText === null) return "room-connected";
    return DISCONNECTED_RE.test(p.statusText) ? "room-disconnected" : "room-connected";
  }
  if (p.found.entryPassword || p.found.entryForm) return "entry";
  return "unknown";
}

/** Parse visitor-list entries: online names precede the first <div> divider. */
export interface VisitorEntry {
  tag: string;
  name: string | null;
}

export function onlineFromVisitorList(entries: VisitorEntry[]): string[] {
  const online: string[] = [];
  for (const e of entries) {
    if (e.tag === "DIV") break;
    if (e.tag === "P" && e.name) online.push(collapse(e.name));
  }
  return online;
}
