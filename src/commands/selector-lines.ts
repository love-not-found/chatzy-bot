/** Text and URLs are treated identically: one non-empty line is one response. */
export function parseSelectorLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
