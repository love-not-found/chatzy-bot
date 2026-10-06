/**
 * Chatzy shows a "You seem to be away" prompt after 60 minutes without
 * activity and shows the user out 60 minutes later. The bot performs a silent
 * activity at random intervals well below that limit so the pattern is irregular.
 */
export function nextKeepaliveDelay(minMs: number, maxMs: number, random: () => number = Math.random): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return Math.round(lo + random() * (hi - lo));
}
