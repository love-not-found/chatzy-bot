import path from "node:path";
import { ChatzySession } from "./chatzy/session.ts";
import { loadChatzyConfig, loadDiscordConfig } from "./config.ts";
import { createHandlers } from "./coordinator.ts";
import { createWebhookOutlet, type WebhookOutlet } from "./discord/outlet.ts";
import { createLogger, registerSecret, setLogLevel } from "./logger.ts";
import { SettingsStore, fields } from "./settings.ts";
import { createWebHandler } from "./web/server.ts";

const log = createLogger("main");

async function main(): Promise<void> {
  const store = new SettingsStore(path.resolve(process.env.CONFIG_DIR ?? "./config"));
  await store.load();
  let session: ChatzySession | null = null;
  let outlet: WebhookOutlet | null = null;
  let runtimeError: string | null = null;
  let applying = false;
  let stopping = false;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.then(fn);
    chain = result.catch(() => {});
    return result;
  };

  const apply = () => serial(async () => {
    if (stopping) throw new Error("Bot is shutting down");
    applying = true;
    runtimeError = null;
    try {
      await session?.stop();
      session = null;
      outlet = null;
      const env = store.runtimeEnv();
      for (const f of fields.filter((f) => f.type === "password")) {
        registerSecret(env[f.key]);
        if (f.key.includes("WEBHOOK")) registerSecret(env[f.key]?.split("/").pop());
      }
      setLogLevel(env.LOG_LEVEL as "debug" | "info" | "warn" | "error");
      if (!store.configured()) return; // First-run setup: serve UI without a bot session.
      const config = loadChatzyConfig(env);
      outlet = createWebhookOutlet(loadDiscordConfig(env));
      const activeOutlet = outlet;
      const activeSession: ChatzySession = new ChatzySession(config, createHandlers(
        () => activeSession, activeOutlet,
        { novncUrl: config.novncUrl, env, commands: () => store.commands },
      ));
      session = activeSession;
      await session.start();
    } catch (e) {
      runtimeError = "Bot could not start. Check container logs and browser access, then use Reconnect.";
      log.error("settings applied but bot start failed", { error: e });
    } finally {
      applying = false;
    }
  });

  const status = () => ({
    applying, configured: store.configured(), error: runtimeError,
    chatzy: session?.status() ?? null, discord: outlet?.status() ?? null,
    novncUrl: store.env.NOVNC_PUBLIC_URL || null,
    configDir: store.dir,
  });

  const webPort = Number(process.env.WEBUI_PORT ?? 3000);
  const healthPort = Number(process.env.HEALTH_PORT ?? 8080);
  registerSecret(process.env.WEBUI_PASSWORD);
  const web = Bun.serve({
    hostname: process.env.WEBUI_HOST ?? "0.0.0.0", port: webPort, idleTimeout: 120,
    fetch: createWebHandler(store, {
      status, apply,
      reload: () => serial(async () => { if (!session) throw new Error("Configure the bot first"); await session.reload(); }),
      reconnect: async () => { await apply(); },
    }, process.env.WEBUI_PASSWORD),
  });
  const health = Bun.serve({
    hostname: "127.0.0.1", port: healthPort,
    fetch() {
      const s = session?.status();
      const stuck = !applying && !!s && Date.now() - s.lastTickAt > 60_000;
      return Response.json({ ok: !stuck, chatzy: s?.state ?? "setup", discord: outlet?.status() ?? null }, { status: stuck ? 503 : 200 });
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const force = setTimeout(() => process.exit(1), 25_000);
    void serial(async () => {
      await session?.stop();
      await web.stop(true);
      await health.stop(true);
      clearTimeout(force);
      process.exit(0);
    });
  });
  log.info("web UI listening", { port: webPort, config: store.dir });
  await apply();
}

main().catch((e) => { log.error("fatal", { error: e }); process.exit(1); });
