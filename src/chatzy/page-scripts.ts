/**
 * Functions in this file are serialized and executed INSIDE the Chromium page
 * via page.evaluate(). They must be fully self-contained: no imports, no
 * references to module-level values.
 */
import type { SelectorMap } from "./selectors.ts";
import type { PageProbe, RawLine } from "./types.ts";
import type { VisitorEntry } from "./parser.ts";

export const BINDING_NAME = "__chatzyBotLine";

export function probePage(sel: SelectorMap): PageProbe {
  const q = (list: readonly string[]): Element | null => {
    for (const s of list) {
      try {
        const el = document.querySelector(s);
        if (el) return el;
      } catch {
        /* unsupported selector */
      }
    }
    return null;
  };
  const found: Record<string, boolean> = {};
  for (const [key, list] of Object.entries(sel)) found[key] = q(list) !== null;
  const status = q(sel.connectionStatus);
  const alias = q(sel.ownAlias);
  const w = window as unknown as { __chatzyBot?: { log: Element } };
  const log = q(sel.messageLog);
  return {
    url: location.href,
    title: document.title,
    found,
    statusText: status ? (status.textContent ?? "").trim() : null,
    ownAlias: alias ? (alias.textContent ?? "").trim() || null : null,
    observerInstalled: !!w.__chatzyBot && w.__chatzyBot.log.isConnected && w.__chatzyBot.log === log,
  };
}

export function installObserver(args: { messageLog: readonly string[]; settleMs: number; binding: string }): boolean {
  type Bot = { observer: MutationObserver; log: Element };
  const w = window as unknown as Record<string, unknown> & { __chatzyBot?: Bot };
  w.__chatzyBot?.observer.disconnect();

  let log: Element | null = null;
  for (const s of args.messageLog) {
    try {
      log = document.querySelector(s);
    } catch {
      log = null;
    }
    if (log) break;
  }
  if (!log) return false;

  const installedAt = Date.now();
  const extract = (p: HTMLElement): RawLine => {
    const b = p.querySelector("b");
    return {
      classes: Array.from(p.classList),
      author: b ? b.textContent : null,
      text: p.textContent ?? "",
      links: Array.from(p.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /^https?:/i.test(h)),
      images: Array.from(p.querySelectorAll("img[src]"))
        .map((i) => (i as HTMLImageElement).src)
        .filter((s) => !s.includes("/elements/")),
    };
  };

  // Everything already in the log is history: never process it.
  log.querySelectorAll("p").forEach((p) => ((p as HTMLElement).dataset.cbSeen = "1"));

  const handle = (node: Element) => {
    const lines = node.tagName === "P" ? [node] : Array.from(node.querySelectorAll("p"));
    for (const el of lines) {
      const p = el as HTMLElement;
      if (p.dataset.cbSeen) continue;
      p.dataset.cbSeen = "1";
      // Chatzy may re-render recent history shortly after (re)connecting.
      if (Date.now() - installedAt < args.settleMs) continue;
      const fn = w[args.binding] as ((l: RawLine) => void) | undefined;
      fn?.(extract(p));
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((n) => n.nodeType === 1 && handle(n as Element));
  });
  observer.observe(log, { childList: true, subtree: true });
  w.__chatzyBot = { observer, log };
  return true;
}

export function readVisitorList(list: readonly string[]): VisitorEntry[] | null {
  let root: Element | null = null;
  for (const s of list) {
    try {
      root = document.querySelector(s);
    } catch {
      root = null;
    }
    if (root) break;
  }
  if (!root) return null;
  return Array.from(root.children)
    .filter((c) => c.tagName !== "H3")
    .map((c) => ({
      tag: c.tagName,
      name: c.getAttribute("title") ?? (c.textContent ?? "").trim() ?? null,
    }));
}
