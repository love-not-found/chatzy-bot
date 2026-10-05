# chatzy-bot

A self-hosted bot that sits in a private [Chatzy](https://www.chatzy.com) room through a real Chromium browser and posts to Discord through a webhook.

Communication is **one-way, Chatzy → Discord**. Nothing from Discord reaches Chatzy, and there are no Discord slash commands.

- **Join notices**: new “joined the chat” system messages trigger Discord notices. Visitor-list changes do not trigger notifications.
- **Explicit relay**: `!relay <text>` in Chatzy posts the text to Discord under the sender's Chatzy name. Nothing else is mirrored.
- **Chatzy `!` commands**: `!help`, `!joke`, `!relay`.
- **Connection alerts**: connected, connection lost/restored, and "needs manual attention" are posted to Discord.
- **Manual browser control**: the bot's Chromium is visible over noVNC, so you can type the room password, deal with VPN checks, or reload by hand. The bot pauses while it waits for you and resumes automatically once it is back in the room.

Design notes are in [`planning/implementation-plan.md`](planning/implementation-plan.md).

## Development (Nix + Bun)

```sh
nix develop            # bun, Playwright browsers, Xvfb, x11vnc
bun install
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

## Discord setup

1. In Discord, open the channel's settings, then *Integrations* > *Webhooks* > *New Webhook*.
2. Copy the webhook URL into `DISCORD_WEBHOOK_URL`.
3. Optionally, create a second webhook in another channel and set it as `DISCORD_NOTIFY_WEBHOOK_URL`. Join notices and alerts then go there, and relays stay in the first channel.

Relayed text keeps inline formatting (bold, italic, strike, spoilers, code) and links. Mentions (`@everyone`, roles, users) never ping or show as highlights, and hidden links like `[text](url)` and headings, quotes and lists are shown as plain text. The webhook token is redacted from logs.

## Deployment (Docker / Podman)

```sh
cp .env.example .env    # fill in, set VNC_PASSWORD and NOVNC_BIND
mkdir -p data           # must be writable by uid 1000
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
- Short disconnects are handled by reloading, with growing waits between attempts.
- After `CHATZY_MAX_AUTO_RETRIES` failures, the bot stops retrying, alerts Discord, and waits for you.
- To retry from scratch, reload the page through noVNC or restart the container (`docker compose restart`).
- Waiting for an operator does not make the container unhealthy, so Docker will not restart-loop.

**Stopping:** `docker compose stop` gives the bot 30s to send `/bye` and close the browser.

## Portainer deployment

Use [`portainer-compose.yaml`](portainer-compose.yaml) for a **Docker Standalone** stack:

1. Open **Stacks → Add stack** and paste the file into the web editor, or deploy from this repository with the Compose path set to `portainer-compose.yaml`.
2. Under **Environment variables**, use **Load variables from .env file** to upload your configured `.env`, or enter the values individually. The Compose file passes them explicitly into the container; it does not require an `.env` file on the server.
3. Set `DISCORD_WEBHOOK_URL` and `CHATZY_ROOM_URL`. For browser access, also set `VNC_PASSWORD`, `NOVNC_BIND` to the Docker host's LAN/VPN IP, and `NOVNC_PUBLIC_URL` to `http://<that-ip>:6080/vnc.html`.
4. Deploy the stack. If the GHCR image is private, configure GHCR credentials in Portainer's **Registries** first.

The stack stores the browser profile in a Docker-managed named volume, retained across container updates. `DATA_DIR` and `HEALTH_PORT` are fixed internally to `/data` and `8080`; local values for these are ignored. To refresh the image, use Portainer's stack update with the option to re-pull the image enabled.

## Security

- Never commit `.env`, `data/`, HAR files or WebSocket captures. They contain Chatzy session tokens and are listed in `.gitignore`.
- Secrets (webhook token, room password, VNC password) are redacted from logs.
- If the webhook URL leaks, delete or regenerate it in the channel's *Integrations* settings.
