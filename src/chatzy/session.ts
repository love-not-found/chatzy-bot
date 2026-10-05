import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ChatzyConfig } from "../config.ts";
import { createLogger } from "../logger.ts";
import { classifyPage, onlineFromVisitorList, parseLine } from "./parser.ts";
import { BINDING_NAME, installObserver, probePage, readVisitorList } from "./page-scripts.ts";
import { JoinDetector } from "./presence.ts";
import { optionalInRoom, selectors, type SelectorKey } from "./selectors.ts";
import { SendQueue } from "./sender.ts";
import type { ChatzyEvent, PageKind, RawLine, SessionState } from "./types.ts";

const log = createLogger("chatzy");

const TICK_MS = 3_000;
const PRESENCE_MS = 15_000;
const SETTLE_MS = 3_000;
const DISCONNECTED_GRACE_MS = 30_000;
const UNKNOWN_GRACE_MS = 60_000;
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export interface SessionHandlers {
  /** Every parsed line from the message log (including the bot's own). */
  onEvent?(e: ChatzyEvent): void;
  /** Deduplicated join of another user. */
  onJoin?(name: string): void;
  onStateChange?(state: SessionState, prev: SessionState, reason?: string): void;
  /** Optional in-room hooks could not be found. */
  onSelectorWarning?(missing: SelectorKey[]): void;
}

export interface SessionStatus {
  state: SessionState;
  alias: string;
  online: string[];
  connectedSince: number | null;
  lastEventAt: number | null;
  failures: number;
  pageKind: PageKind | null;
  lastTickAt: number;
}

const css = (list: readonly string[]) => list.join(", ");

/** Chatzy redirects between hosts (e.g. us28.chatzy.com -> www.chatzy.com). */
function isChatzyUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "chatzy.com" || h.endsWith(".chatzy.com");
  } catch {
    return false;
  }
}

/** Room path such as "/57294990782276", identical across Chatzy hosts. */
function roomPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export class ChatzySession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private state: SessionState = "starting";
  private pageKind: PageKind | null = null;
  private failures = 0;
  private nextActionAt = 0;
  private notConnectedSince: number | null = null;
  private connectedSince: number | null = null;
  private lastEventAt: number | null = null;
  private lastPresenceAt = 0;
  private lastTickAt = Date.now();
  private selfAlias: string;
  private warnedSelectors = "";
  private timer: Timer | null = null;
  private stopping = false;
  private lock: Promise<unknown> = Promise.resolve();

  readonly joins: JoinDetector;
  readonly sender: SendQueue;

  constructor(
    private readonly config: ChatzyConfig,
    private readonly handlers: SessionHandlers = {},
  ) {
    this.selfAlias = config.alias;
    this.joins = new JoinDetector((n) => this.isSelf(n));
    this.sender = new SendQueue((line) => this.deliver(line), config.sendIntervalMs);
  }

  isSelf(name: string): boolean {
    return name === this.selfAlias;
  }

  status(): SessionStatus {
    return {
      state: this.state,
      alias: this.selfAlias,
      online: this.joins.onlineUsers,
      connectedSince: this.connectedSince,
      lastEventAt: this.lastEventAt,
      failures: this.failures,
      pageKind: this.pageKind,
      lastTickAt: this.lastTickAt,
    };
  }

  async start(): Promise<void> {
    await this.launch();
    await this.exclusive(() => this.navigate());
    this.timer = setInterval(() => void this.exclusive(() => this.tick()), TICK_MS);
    void this.exclusive(() => this.tick());
  }

  /** Send user-visible text to the room. */
  send(text: string): Promise<void> {
    if (this.state !== "connected") return Promise.reject(new Error(`Chatzy is not connected (${this.state})`));
    return this.sender.send(text);
  }

  /** Reload the current page (operator action). */
  reload(): Promise<void> {
    return this.exclusive(async () => {
      log.info("reload requested");
      await this.ensurePage().reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    });
  }

  /** Clear retry counters and reopen the room URL. */
  reconnect(): Promise<void> {
    return this.exclusive(async () => {
      log.info("reconnect requested");
      this.failures = 0;
      this.nextActionAt = 0;
      this.setState("reconnecting", "manual reconnect");
      if (!this.context) await this.launch();
      await this.navigate();
    });
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.sender.drain(3_000);
    this.sender.close();
    if (this.state === "connected" && this.page && !this.page.isClosed()) {
      try {
        log.info("leaving room with /bye");
        await this.deliver("/bye");
        await Bun.sleep(1_500);
      } catch (e) {
        log.warn("could not leave room cleanly", { error: e });
      }
    }
    await this.context?.close().catch(() => {});
    this.context = null;
    this.setState("stopped", "shutdown");
  }

  // ---------------------------------------------------------------------------

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  private setState(next: SessionState, reason?: string): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    log.info("state change", { from: prev, to: next, reason });
    if (next !== "connected") this.sender.clear(`Chatzy ${next}`);
    this.handlers.onStateChange?.(next, prev, reason);
  }

  private async launch(): Promise<void> {
    await mkdir(this.config.profileDir, { recursive: true });
    // A crashed Chromium leaves lock files that block the next launch.
    for (const f of await readdir(this.config.profileDir)) {
      if (f.startsWith("Singleton")) await rm(path.join(this.config.profileDir, f), { force: true });
    }
    log.info("launching chromium", { profile: this.config.profileDir });
    const context = await chromium.launchPersistentContext(this.config.profileDir, {
      headless: false,
      viewport: null,
      // We shut the browser down ourselves after sending /bye.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: ["--window-position=0,0", "--window-size=1280,800", "--no-first-run", "--disable-features=Translate"],
    });
    await context.exposeFunction(BINDING_NAME, (line: RawLine) => this.onRawLine(line));
    context.on("close", () => {
      if (this.context === context) {
        if (!this.stopping) log.warn("browser closed");
        this.context = null;
        this.page = null;
      }
    });
    this.context = context;
    this.page = context.pages()[0] ?? (await context.newPage());
  }

  private ensurePage(): Page {
    if (!this.context) throw new Error("browser is not running");
    if (!this.page || this.page.isClosed()) {
      const open = this.context.pages().filter((p) => !p.isClosed());
      this.page = open.find((p) => isChatzyUrl(p.url())) ?? open[0] ?? null;
      if (!this.page) throw new Error("no open browser tab");
    }
    return this.page;
  }

  private async navigate(): Promise<void> {
    log.info("opening room");
    await this.ensurePage()
      .goto(this.config.roomUrl, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch((e) => log.warn("navigation failed", { error: e }));
  }

  private scheduleBackoff(): void {
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, this.failures - 1), BACKOFF_MAX_MS);
    this.nextActionAt = Date.now() + delay + Math.random() * 5_000;
  }

  private async tick(): Promise<void> {
    if (this.stopping) return;
    const now = Date.now();
    this.lastTickAt = now;

    if (!this.context) {
      if (now < this.nextActionAt) return;
      this.setState("reconnecting", "browser not running");
      this.failures++;
      this.scheduleBackoff();
      try {
        await this.launch();
        await this.navigate();
      } catch (e) {
        log.error("browser relaunch failed", { error: e });
      }
      return;
    }

    let page: Page;
    try {
      page = this.ensurePage();
    } catch {
      this.page = await this.context.newPage();
      await this.navigate();
      return;
    }

    const probe = await page.evaluate(probePage, selectors).catch(() => null);
    const kind: PageKind = probe ? classifyPage(probe) : "unknown";
    if (kind !== this.pageKind) log.debug("page kind", { kind, url: probe?.url });
    this.pageKind = kind;

    if (kind === "room-connected" && probe) {
      this.selfAlias = probe.ownAlias ?? this.selfAlias;
      if (!probe.observerInstalled) {
        const ok = await page
          .evaluate(installObserver, { messageLog: selectors.messageLog, settleMs: SETTLE_MS, binding: BINDING_NAME })
          .catch(() => false);
        if (!ok) return;
        log.info("message observer installed", { alias: this.selfAlias });
        this.joins.reset();
        this.lastPresenceAt = 0;
        const missing = optionalInRoom.filter((k) => !probe.found[k]);
        if (missing.join() !== this.warnedSelectors) {
          this.warnedSelectors = missing.join();
          if (missing.length) {
            log.warn("optional selectors missing", { missing });
            this.handlers.onSelectorWarning?.(missing);
          }
        }
      }
      this.notConnectedSince = null;
      if (this.state !== "connected") {
        this.failures = 0;
        this.connectedSince = now;
        this.setState("connected");
      }
      if (now - this.lastPresenceAt >= PRESENCE_MS) await this.pollPresence(page);
      return;
    }

    // Not connected.
    if (this.state === "connected") {
      this.connectedSince = null;
      this.setState("disconnected", kind === "entry" ? "returned to entry page" : `page is ${kind}`);
    }
    this.notConnectedSince ??= now;
    if (this.state === "waiting_for_operator") return; // hands off until the room is back

    if (kind === "entry") {
      if (!this.config.autoJoin) {
        this.setState("waiting_for_operator", "auto-join is off, please enter the room manually");
        return;
      }
      if (this.failures >= this.config.maxAutoRetries) {
        this.setState("waiting_for_operator", `automatic room entry failed ${this.failures} times`);
        return;
      }
      if (now < this.nextActionAt) return;
      this.setState("joining");
      this.failures++;
      this.scheduleBackoff();
      if (!(await this.tryAutoJoin(page))) {
        this.setState("waiting_for_operator", "room asks for a password but CHATZY_PASSWORD is not set");
      }
      return;
    }

    const grace = kind === "room-disconnected" ? DISCONNECTED_GRACE_MS : UNKNOWN_GRACE_MS;
    if (now - this.notConnectedSince < grace || now < this.nextActionAt) return;
    if (this.failures >= this.config.maxAutoRetries) {
      this.setState("waiting_for_operator", `automatic recovery failed ${this.failures} times`);
      return;
    }
    this.failures++;
    this.scheduleBackoff();
    this.setState("reconnecting", `page is ${kind}`);
    const sameRoom = !!probe && isChatzyUrl(probe.url) && roomPath(probe.url) === roomPath(this.config.roomUrl);
    if (sameRoom) await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    else await this.navigate();
  }

  /** Returns false if a password is required but not configured. */
  private async tryAutoJoin(page: Page): Promise<boolean> {
    log.info("attempting automatic room entry", { attempt: this.failures });
    try {
      const pw = page.locator(`${css(selectors.entryPassword)} >> visible=true`).first();
      const hasPassword = (await pw.count()) > 0;
      if (hasPassword && !this.config.password) return false;

      const form = hasPassword
        ? pw.locator("xpath=ancestor::form[1]")
        : page.locator(css(selectors.entryForm)).first();
      const name = form.locator('input[type="text"] >> visible=true').first();
      if (await name.count()) {
        const current = await name.inputValue();
        if (current !== this.config.alias) await name.fill(this.config.alias, { timeout: 5_000 });
      }
      if (hasPassword) await pw.fill(this.config.password!, { timeout: 5_000 });

      const submit = form.locator('input[type="submit"], button[type="submit"]').first();
      if (await submit.count()) await submit.click({ timeout: 5_000 });
      else await (hasPassword ? pw : name).press("Enter");
    } catch (e) {
      log.warn("automatic entry failed", { error: e });
    }
    return true;
  }

  private async pollPresence(page: Page): Promise<void> {
    this.lastPresenceAt = Date.now();
    const entries = await page.evaluate(readVisitorList, selectors.visitorList).catch(() => null);
    if (!entries) return;
    this.joins.onSnapshot(onlineFromVisitorList(entries));
  }

  private onRawLine(line: RawLine): void {
    const ev = parseLine(line);
    this.lastEventAt = Date.now();
    log.debug("event", { ev });
    if (ev.type === "join" && this.joins.onJoinLine(ev.user)) {
      log.info("join", { user: ev.user });
      this.handlers.onJoin?.(ev.user);
    } else if (ev.type === "leave") {
      this.joins.onLeaveLine(ev.user);
    }
    try {
      this.handlers.onEvent?.(ev);
    } catch (e) {
      log.error("event handler failed", { error: e });
    }
  }

  private async deliver(line: string): Promise<void> {
    if (!this.page || this.page.isClosed()) throw new Error("no Chatzy page");
    const input = this.page.locator(css(selectors.messageInput)).first();
    await input.fill(line, { timeout: 5_000 });
    await input.press("Enter", { timeout: 5_000 });
  }
}
