import { ChatzySession } from "./chatzy/session.ts";
import { loadChatzyConfig, loadDiscordConfig } from "./config.ts";
import { createHandlers } from "./coordinator.ts";
import { createWebhookOutlet } from "./discord/outlet.ts";
import { createLogger, registerSecret, setLogLevel } from "./logger.ts";

const log = createLogger("main");

/** The token is the last path segment of a webhook URL. */
function webhookToken(url: string): string | undefined {
  return url.split("/").pop();
}

async function main(): Promise<void> {
  const chatzyConfig = loadChatzyConfig();
  const discordConfig = loadDiscordConfig();
  setLogLevel(chatzyConfig.logLevel);
  registerSecret(webhookToken(discordConfig.relayWebhookUrl));
  registerSecret(webhookToken(discordConfig.notifyWebhookUrl));
  registerSecret(chatzyConfig.password);
  registerSecret(process.env.VNC_PASSWORD);

  const outlet = createWebhookOutlet(discordConfig);
  const session: ChatzySession = new ChatzySession(
    chatzyConfig,
    createHandlers(() => session, outlet, { novncUrl: chatzyConfig.novncUrl }),
  );

  const health = Bun.serve({
    hostname: "127.0.0.1",
    port: chatzyConfig.healthPort,
    fetch() {
      const s = session.status();
      // Only report unhealthy if the supervisor loop itself is stuck. Waiting for
      // an operator is a normal state and must not trigger a container restart.
      const stuck = Date.now() - s.lastTickAt > 60_000;
      return Response.json(
        { ok: !stuck, chatzy: s.state, page: s.pageKind, online: s.online.length, discord: outlet.status() },
        { status: stuck ? 503 : 200 },
      );
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    const force = setTimeout(() => process.exit(1), 25_000);
    try {
      await session.stop();
      await health.stop(true);
    } catch (e) {
      log.error("error during shutdown", { error: e });
    }
    clearTimeout(force);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await session.start();
  log.info("bot running", { health: `http://127.0.0.1:${chatzyConfig.healthPort}/` });
}

main().catch((e) => {
  log.error("fatal", { error: e });
  process.exit(1);
});
