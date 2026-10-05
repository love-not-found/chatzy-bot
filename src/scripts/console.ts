/**
 * Chatzy-only harness: no Discord needed.
 *
 *   bun run chatzy:console
 *
 * Opens the room in a visible Chromium window, prints room events, answers
 * !commands, and sends every line typed on stdin to the room.
 * Only CHATZY_ROOM_URL (and optionally CHATZY_*) must be set.
 */
import { ChatzySession } from "../chatzy/session.ts";
import { loadChatzyConfig } from "../config.ts";
import { createHandlers } from "../coordinator.ts";
import { registerSecret, setLogLevel } from "../logger.ts";

const config = loadChatzyConfig();
setLogLevel(config.logLevel);
registerSecret(config.password);

const handlers = createHandlers(
  () => session,
  {
    relayFromChatzy: async (user, text) => console.log(`>>> RELAY to Discord: [Chatzy] ${user}: ${text}`),
    notifyJoin: async (user) => console.log(`>>> JOIN: ${user}`),
    notify: async (text) => console.log(`>>> NOTICE: ${text}`),
  },
  { novncUrl: config.novncUrl },
);
const session: ChatzySession = new ChatzySession(config, {
  ...handlers,
  onEvent(ev) {
    console.log("event", JSON.stringify(ev));
    handlers.onEvent?.(ev);
  },
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await session.stop();
    process.exit(0);
  });
}

await session.start();
console.log("Type a line and press Enter to send it to the room. Ctrl+C leaves the room and exits.");
for await (const line of console) {
  const text = line.trim();
  if (!text) continue;
  if (text === ":status") console.log(session.status());
  else session.send(text).catch((e) => console.error("send failed:", e.message));
}
