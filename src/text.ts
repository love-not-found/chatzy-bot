/** Chatzy's input has maxlength=4000; stay below it. */
export const CHATZY_MAX_LEN = 3900;

/** Normalize text for a single-line Chatzy input. */
export function toChatzyLine(text: string): string {
  // Control chars and newlines would be dropped or truncate the input.
  let out = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  // A leading "/" would be executed as a Chatzy command (e.g. /bye, /clear).
  if (out.startsWith("/")) out = "\u200b" + out;
  return out;
}

/** Split into chunks of at most `max` chars, preferring whitespace boundaries. */
export function splitMessage(text: string, max = CHATZY_MAX_LEN): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const URL_RE = /https?:\/\/[^\s<>]+/g;
const MD_RE = /[\\*_~`|>#\-\[\]()<:]/g;
const ZWSP = "\u200b";

/** Apply `fn` to the text between URLs; URLs stay untouched so Discord still links/embeds them. */
function outsideUrls(text: string, fn: (s: string) => string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

/**
 * Stop "@everyone", "@here" and "@name" from rendering as highlighted mention
 * pills. (allowed_mentions already prevents actual pings.)
 */
function breakMentions(s: string): string {
  return s.replace(/@(?=\S)/g, `@${ZWSP}`);
}

/**
 * Escape all Discord markdown so text renders literally. Used for names and
 * other text that must never be formatted.
 */
export function escapeDiscord(text: string): string {
  return outsideUrls(text, (s) => breakMentions(s.replace(MD_RE, "\\$&")));
}

/**
 * Format a relayed Chatzy message for Discord. Inline formatting
 * (**bold**, *italic*, __underline__, ~~strike~~, ||spoiler||, `code`) renders
 * as Discord users expect. Disabled: mention pills, <@id>/<#id>/<t:..> tags,
 * masked links ([text](url)) that could disguise a URL, and block formatting
 * (# headings, -# subtext, > quotes, lists) that would distort the layout.
 */
export function formatRelay(text: string): string {
  const body = outsideUrls(text, (s) =>
    breakMentions(s.replace(/</g, "\\<").replace(/\[/g, "\\[")),
  );
  // Chatzy lines are single-line, so block syntax can only occur at the start.
  return body.replace(/^(\s*)(#|-#|>|[-*+](?=\s)|\d+[.)](?=\s))/, (_m, sp: string, tok: string) => sp + "\\" + tok);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean);
  return parts.join(" ");
}
