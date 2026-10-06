/** Serializable line data extracted inside the browser. */
export interface RawLine {
  /** class attribute tokens of the <p> */
  classes: string[];
  /** text of the first <b> (author / subject), if any */
  author: string | null;
  /** full textContent of the line */
  text: string;
  /** href values of links in the line */
  links: string[];
  /** src values of images in the line (excluding Chatzy UI icons) */
  images: string[];
}

export type ChatzyEvent =
  | { type: "message"; user: string; text: string; links: string[]; images: string[] }
  | { type: "join"; user: string }
  | { type: "leave"; user: string }
  | { type: "system"; text: string };

export interface PageProbe {
  url: string;
  title: string;
  found: Record<string, boolean>;
  statusText: string | null;
  ownAlias: string | null;
  observerInstalled: boolean;
  /** Chatzy's "You seem to be away" inactivity prompt is on screen. */
  awayPromptVisible: boolean;
  /** Start of the visible page text when the room UI is absent, for diagnostics. */
  bodyText: string | null;
}

export type PageKind = "room-connected" | "room-disconnected" | "entry" | "unknown";

export type SessionState =
  | "starting"
  | "joining"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "waiting_for_operator"
  | "stopped";
