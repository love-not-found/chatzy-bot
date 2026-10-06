// Executed by the container entrypoint before x11vnc starts. Reuse the same
// first-run/env precedence as the app so UI-saved passwords survive restarts.
import path from "node:path";
import { SettingsStore } from "../settings.ts";
const store = new SettingsStore(path.resolve(process.env.CONFIG_DIR ?? "/config"));
await store.load();
process.stdout.write(store.env.VNC_PASSWORD ?? "");
