# chatzy-bot

A self-hosted bot that sits in a private [Chatzy](https://www.chatzy.com) room through a real Chromium browser and posts to Discord through a webhook.

Communication is **one-way, Chatzy → Discord**. Nothing from Discord reaches Chatzy, and there are no Discord slash commands.

- **Join notices**: new “joined the chat” system messages trigger Discord notices. Visitor-list changes do not trigger notifications.
- **Explicit relay**: `!relay <text>` in Chatzy posts the text to Discord under the sender's Chatzy name. Nothing else is mirrored.
- **Chatzy `!` commands**: `!help`, `!relay`, and customizable random selectors such as `!joke` or `!jenna`.
- **Stays active**: Chatzy asks "You seem to be away" after 60 minutes without activity and shows the user out 60 minutes later.
  - Keep-alive: at a random interval of 10–25 minutes (`CHATZY_KEEPALIVE_*`), the bot silently opens and closes *My Messages*. Chatzy counts this as activity, and nothing is posted in the room.
  - Prompt: if the prompt still appears, the bot clicks *I am here!*.
  - Sent messages also count as activity and push the next keep-alive back.
- **Connection alerts**: initial connection and persistent failures are posted to Discord. Brief interruptions recover silently; “restored” is posted only after an announced failure.
- **Manual browser control**: the bot's Chromium is visible over noVNC, so you can type the room password, deal with VPN checks, or reload by hand. The bot pauses while it waits for you and resumes automatically once it is back in the room.

Design notes are in [`planning/implementation-plan.md`](planning/implementation-plan.md).

## Development (Nix + Bun)

```sh
nix develop            # bun, Playwright browsers, Xvfb, x11vnc
bun install
bun run build:web       # SolidJS static assets; required before UI tests/start
bun test               # unit + fixture-browser tests
bun run typecheck
```

The `playwright` version in `package.json` must equal nixpkgs' `playwright-driver` version (the dev shell warns if they differ). After `nix flake update`, update the pin: `bun add playwright@<version>`.

### Try the Chatzy side without Discord

```sh
CHATZY_ROOM_URL=https://us28.chatzy.com/57294990782276 CHATZY_AUTO_JOIN=true bun run chatzy:console
```

A Chromium window opens on your desktop. Room events are printed, `!joke`/`!help`/`!relay` are answered (relays are printed), and each line you type is sent to the room. Ctrl+C leaves the room with `/bye`.

### Run the full bot locally

```sh
cp .env.example .env   # fill in the webhook URL and Chatzy values
bun run start          # Bun loads .env automatically
```

Status is available at `http://127.0.0.1:8080/` (Chatzy state, online count, last webhook error).

## Web UI (SolidJS)

Open `http://<server>:3000` to access the control room. It provides:

- Live connection status, online visitors, webhook delivery status, and the next keep-alive time.
- **Open browser** (your saved VNC public URL), **Reload page**, and **Reconnect** buttons.
- Chatzy room, alias, password and auto-join settings.
- Discord webhooks, display name, join notifications and connection-alert toggles.
- Recovery attempts/window and random keep-alive intervals.
- Command prefix, built-in command toggles, and relay cooldown.
- A searchable **Custom commands → Random selector** list: create, rename, enable/disable, edit and remove commands with their own responses and cooldowns.

### Custom commands: Random selector

1. Scroll to **Custom commands**, then click **Add random selector**.
2. Enter a command name **without the prefix**, for example `jenna`.
3. Set an optional description (shown in `!help`), per-user cooldown, and whether to avoid immediate repeats.
4. Paste the responses into **Responses (one per line)**:

   ```text
   https://example.com/image-one.jpg
   https://example.com/image-two.gif
   https://example.com/image-three.png
   ```

5. Click **Save commands**, then type `!jenna` in Chatzy. The bot selects one line randomly and sends it to the room. Whether the image displays inline depends on Chatzy.

The same category supports text: the default `joke` command contains one joke per line. You can rename it, replace its responses, disable it, remove it, or add other selectors. Blank lines are ignored. Command names are case-insensitive and support letters, numbers and underscores (starting with a letter). `help` and `relay` are reserved for the built-ins. Enabled custom commands appear in the help list. All commands use the configured prefix, which defaults to `!`.

**Save commands** applies immediately without restarting the browser or bot session. Response selection avoids the previous value by default when alternatives exist; turn off **Avoid immediate repeats** to permit consecutive repeats. An empty list produces a short “No values configured” response.

**Persistence:** mount a host directory as `/config`:

```yaml
volumes:
  - /path/to/config:/config
```

Create that directory on the Docker host and make it writable by the container user (UID 1000). `CONFIG_PATH` controls this bind mount in both Compose files. Set it to an **absolute host path in Portainer**, such as `/opt/chatzy-bot/config`.

The directory contains `settings.json`, `commands.json`, and `browser-profile/`. Settings files are written atomically with owner-only permissions. Back up this directory to preserve settings, custom responses, cookies and login state. `/data` is retained in Compose for existing installations, but the full bot now uses `/config/browser-profile`. To preserve an existing login, stop the bot and copy the old `/data/browser-profile` into the new configuration directory as `browser-profile` before starting the new image.

On upgrade, the earlier `jokes.json` collection automatically becomes the `joke` random selector in `commands.json`. Its enabled state and cooldown are preserved. The old file is left untouched as a backup; once `commands.json` exists, it is the source of truth, including if you delete every custom command.

Environment values seed settings **only on the first run**, when `settings.json` does not exist. After that, use the UI or edit the saved file while the bot is stopped. Changing stack environment variables does not overwrite saved settings. With no room/webhook configured, the UI starts in setup mode so you can enter them there.

**Save & apply** saves general settings and restarts the bot's browser session. **Save commands** updates random selectors immediately without reconnecting. Stored secrets are never sent back to the UI: leave the input blank to keep the value, enter a replacement, or check **Clear saved value**. Changing the VNC password requires a container restart because x11vnc starts outside the bot process.

Deployment settings stay in Compose/environment: `CONFIG_PATH`, `WEBUI_BIND`, `WEBUI_PORT`, `WEBUI_PASSWORD`, `NOVNC_BIND`, and the internal health port. The default UI binding is loopback; set `WEBUI_BIND` to your server's LAN address (or `0.0.0.0` for your test setup) to access it from another device. The standard Compose files publish container port 3000.

Optional UI authentication: set `WEBUI_PASSWORD` in Portainer or `.env` and sign in with username `admin`. Keep the UI on your trusted network; if accessed over an untrusted network, use HTTPS through a reverse proxy. Preserve the public `Host` header and set `X-Forwarded-Proto: https` on the proxy so same-origin settings writes work. The VNC password remains separate.

For UI development, run `bun run start` for the Bun API and `bun run dev:web` for Vite's hot-reloading frontend. Vite proxies `/api` to Bun on port 3000.

## Discord setup

1. In Discord, open the channel's settings, then *Integrations* > *Webhooks* > *New Webhook*.
2. Copy the webhook URL into `DISCORD_WEBHOOK_URL`.
3. Optionally, create a second webhook in another channel and set it as `DISCORD_NOTIFY_WEBHOOK_URL`. Join notices and alerts then go there, and relays stay in the first channel.

Relayed text keeps inline formatting (bold, italic, strike, spoilers, code) and links. Mentions (`@everyone`, roles, users) never ping or show as highlights, and hidden links like `[text](url)` and headings, quotes and lists are shown as plain text. The webhook token is redacted from logs.

## Deployment (Docker / Podman)

```sh
cp .env.example .env    # fill in, set VNC_PASSWORD and NOVNC_BIND
mkdir -p data config    # config must be writable by uid 1000
docker compose pull
docker compose up -d
docker compose logs -f
```

**Image:** `docker-compose.yml` uses the prebuilt `ghcr.io/love-not-found/chatzy-bot:latest`.
- The image is built by the *Docker image* workflow. Start it from the GitHub Actions tab with *Run workflow*.
- The workflow runs the tests, then pushes `latest`, a commit-SHA tag, and an optional custom tag.
- To update the server, run `docker compose pull && docker compose up -d`.
- If the package is private, first run `docker login ghcr.io` with a token that has `read:packages`.
- To build from source instead, uncomment `build: .` in `docker-compose.yml` and run `docker compose up -d --build`.

**Manual control:** open `http://<NOVNC_BIND>:6080/vnc.html` and log in with `VNC_PASSWORD` (max 8 characters).

**Keep noVNC private:** bind it to a LAN or Tailscale address, or keep `127.0.0.1` and use `ssh -L 6080:localhost:6080 server`. Never expose it to the internet.

**First start with a password room:**
- Leave `CHATZY_AUTO_JOIN=false`. The bot posts *"Chatzy needs manual attention"* to Discord.
- Open noVNC, enter the alias and room password yourself, and join.
- The bot detects the room and takes over.
- The browser profile in `./data` keeps cookies across restarts.
- Alternatively, set `CHATZY_PASSWORD` and `CHATZY_AUTO_JOIN=true`.

**Recovery:**
- Short disconnects get a 12-second grace period for Chatzy to reconnect itself.
- The bot then tries up to `CHATZY_MAX_AUTO_RETRIES` recoveries (default 5), spaced across `CHATZY_RECOVERY_TIMEOUT_MS` (default 120000, two minutes). Only after the continuous outage window and retry budget are exhausted does it alert Discord and wait for you. Slow browser operations can extend this window.
- Initial manual login still prompts immediately. If a previously connected room requires manual re-entry, the alert waits for the outage window; credentials are never guessed.
- To retry from scratch, reload the page through noVNC or restart the container (`docker compose restart`).
- Waiting for an operator does not make the container unhealthy, so Docker will not restart-loop.

**Stopping:** `docker compose stop` gives the bot 30s to send `/bye` and close the browser.

## Portainer deployment

Use [`portainer-compose.yaml`](portainer-compose.yaml) for a **Docker Standalone** stack:

1. Open **Stacks → Add stack** and paste the file into the web editor, or deploy from this repository with the Compose path set to `portainer-compose.yaml`.
2. Under **Environment variables**, use **Load variables from .env file** to upload your configured `.env`, or enter the values individually. The Compose file passes them explicitly into the container; it does not require an `.env` file on the server.
3. Set `DISCORD_WEBHOOK_URL` and `CHATZY_ROOM_URL`. For browser access, also set `VNC_PASSWORD`, `NOVNC_BIND` to the Docker host's LAN/VPN IP, and `NOVNC_PUBLIC_URL` to `http://<that-ip>:6080/vnc.html`.
4. Deploy the stack. If the GHCR image is private, configure GHCR credentials in Portainer's **Registries** first.

Set `CONFIG_PATH` to an absolute host directory (e.g. `/opt/chatzy-bot/config`) and `WEBUI_BIND` to your desired host interface. The stack bind-mounts that directory at `/config` and exposes the UI on port 3000. The existing `/data` named volume remains available for migration; new browser profiles live under `/config/browser-profile`. `HEALTH_PORT` remains fixed at `8080`. To refresh the image, use Portainer's stack update with the option to re-pull the image enabled.

## Security

- Never commit `.env`, `data/`, HAR files or WebSocket captures. They contain Chatzy session tokens and are listed in `.gitignore`.
- Secrets (webhook token, room password, VNC password) are redacted from logs.
- If the webhook URL leaks, delete or regenerate it in the channel's *Integrations* settings.
