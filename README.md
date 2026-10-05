# chatzy-bot

A self-hosted bot that sits in a private [Chatzy](https://www.chatzy.com) room through a real Chromium browser and connects it to Discord.

- **Join notices**: when someone enters the Chatzy room, a notice is posted to Discord.
- **Explicit relay**: `!relay <text>` in Chatzy posts to Discord; `/relay` in Discord posts to Chatzy. Nothing else is mirrored.
- **Chatzy `!` commands**: `!help`, `!joke`, `!relay`.
- **Discord slash commands**: `/relay`, `/status`, `/who`, `/reload`, `/reconnect`, `/browser`.
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
cp .env.example .env   # fill in the Discord and Chatzy values
bun run start
```

## Discord setup

1. Create an application at <https://discord.com/developers/applications>, add a bot, and copy its token into `DISCORD_TOKEN`.
2. Invite it with the `bot` and `applications.commands` scopes and the *View Channel*, *Send Messages* permissions on the relay/notification channels.
3. Enable Developer Mode in Discord and copy the server ID and the channel IDs into `.env`.

Slash commands are registered to that one server on startup. `/reload`, `/reconnect` and `/browser` require *Manage Server* by default. You can change that under Server Settings > Integrations, or restrict it further with the `DISCORD_*_IDS` allowlists. Relayed text never triggers pings (`@everyone`, roles, or users).

## Deployment (Docker / Podman)

```sh
cp .env.example .env    # fill in, set VNC_PASSWORD and NOVNC_BIND
mkdir -p data           # must be writable by uid 1000
docker compose up -d --build
docker compose logs -f
```

**Prebuilt image:** run the *Docker image* workflow from the GitHub Actions tab (*Run workflow*). It runs the tests, then pushes `ghcr.io/love-not-found/chatzy-bot:latest` plus a commit-SHA tag and an optional custom tag. To use it, replace `build: .` in `docker-compose.yml` with `image: ghcr.io/love-not-found/chatzy-bot:latest` and run `docker compose pull && docker compose up -d`. If the package is private, first run `docker login ghcr.io` with a token that has `read:packages`.

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
- `/reconnect` resets the retry counter.
- Waiting for an operator does not make the container unhealthy, so Docker will not restart-loop.

**Stopping:** `docker compose stop` gives the bot 30s to send `/bye` and close the browser.

## Security

- Never commit `.env`, `data/`, HAR files or WebSocket captures. They contain Chatzy session tokens and are listed in `.gitignore`.
- Secrets (Discord token, room password, VNC password) are redacted from logs.
