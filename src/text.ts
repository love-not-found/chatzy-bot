import { escapeMarkdown } from "discord.js";

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

/** Escape Discord markdown so Chatzy text renders literally. Mentions are disabled separately via allowedMentions. */
export function escapeDiscord(text: string): string {
  return escapeMarkdown(text, { heading: true, bulletedList: true, numberedList: true, maskedLink: true });
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
