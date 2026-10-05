# Chatzy Discord Bot Implementation Plan

## 1. Goal

Build a self-hosted TypeScript bot that stays connected to a private Chatzy room through a real Chromium browser and integrates the room with Discord.

The first release will:

- Run continuously in a Docker container on an x86_64 home server.
- Join a password-protected Chatzy Premium Room.
- Let an operator manually control the browser when Chatzy, VPN detection, login, or password entry requires human interaction.
- Notify a configured Discord channel when someone joins the Chatzy room.
- Relay messages only when explicitly requested with `!relay` in Chatzy or `/relay` in Discord.
- Run Chatzy-side `!` commands, beginning with `!joke` and `!help`.
- Expose normal Discord slash commands for status and administration.
- Recover from dropped connections without creating duplicate messages or notifications.

Automatic full-room mirroring is deliberately out of scope. Nothing is relayed unless a user invokes the relay command.

## 2. Confirmed Product Behavior

### 2.1 Chatzy commands

Chatzy users invoke bot commands in the room with an exclamation mark:

- `!help` lists available Chatzy commands.
- `!joke` posts one joke selected from a local list back into Chatzy.
- `!relay <message>` posts `<message>` to the configured Discord relay channel.

The relayed Discord message should identify its origin clearly, for example:

```text
[Chatzy] Amour (26): hello from the room
```

The command line itself should not be relayed. The bot cannot remove it from Chatzy, so users will see both their `!relay` command and the bot's resulting action.

Future commands such as `!gif <query>` can use the same command registry, but external GIF APIs are not part of the first release.

### 2.2 Discord commands

Discord users invoke application slash commands:

- `/relay message:<text>` posts the text to Chatzy as `[Discord display name] <text>`.
- `/status` reports browser, Chatzy, and Discord connection status and bot uptime.
- `/who` lists users currently shown as online in Chatzy.
- `/reload` reloads the current Chatzy browser page.
- `/reconnect` starts a clean Chatzy reconnect attempt.
- `/browser` returns instructions or the configured private URL for opening manual browser control.

Administrative commands must be restricted to an allowlist of Discord role IDs and/or user IDs. `/relay` may use a separate allowlist if more users should be permitted to relay than administer the browser.

### 2.3 Join notifications

When a person joins Chatzy, post a small notice in the Discord notification channel:

```text
*Amour (26) joined the Chatzy room.*
```

Notification rules:

- Do not notify for the bot's own alias.
- Do not announce everyone already present when the bot starts or reconnects.
- Use Chatzy's `joined the chat` system line as the primary event source.
- Compare online-presence snapshots as a fallback if a system line is missed.
- Deduplicate primary and fallback events for the same user within a short time window.
- Optionally report leaves later; only joins are required for the first release.

## 3. Why Browser Automation

Chatzy does not expose a supported public API. Its page uses minified/obfuscated JavaScript and a session-specific WebSocket URL containing generated credentials. Reimplementing that protocol would be fragile and could break whenever Chatzy deploys a frontend change.

Playwright will instead drive the same browser interface as a person:

- Join through the normal room form.
- Read messages from the rendered document.
- Send messages through the normal input field.
- Preserve the browser profile and cookies between container restarts.
- Allow a human to take over the exact same browser session when needed.

## 4. Observed Chatzy Page Structure

The supplied in-room HTML currently exposes these hooks:

| Feature | Primary selector | Observed behavior |
| --- | --- | --- |
| Message log | `#X2803` | Contains one `<p>` per chat or system event |
| User chat line | `#X2803 p.a` | `<b class="X7409">Name</b>: message` |
| System line | `#X2803 p.b` | Join and room-start messages |
| Message form | `form#X5031` | Submitting sends the current message |
| Message input | `input#X9225` | Maximum length is currently 4000 |
| Visitor list | `#X5592` | Online users precede a divider; recent offline users follow it |
| Connection state | `#X7483` | Shows `Connected`, then `Updated N seconds ago`; both mean healthy |
| Leave action | `#X7397` | Sends Chatzy's predefined `/bye` behavior |
| Quick Chat entry form | `form#X8823` | Alias `#X8712`, color `#X1711`, submit `#X6668`; no password field |

The `X...` identifiers are generated-looking and must not be scattered through the code. They will live in one selector module. Each important operation will also have a structural fallback, such as `input[maxlength="4000"]`, and startup validation will report selector failures to Discord.

Findings from live testing against the test room (Phase 1–4):

- The IDs were identical across fresh browser sessions, so they are build-level, not per-session.
- `us28.chatzy.com/<room>` redirects to `www.chatzy.com/<room>` for the entry page and back to `us28` after joining. Host checks accept any `*.chatzy.com` host and compare only the room path.
- `#X7483` changes from `Connected` to `Updated 30 seconds ago` after a while. Only explicit failure wording (disconnect, reconnect, lost, error, ...) is treated as disconnected.
- The visitor list is briefly empty right after joining. A snapshot only becomes the join baseline once it contains the bot itself, which prevents false join notices for people already present.
- The bot's own `/bye` appears as `<alias> left the chat`, confirming the leave-line format.
- Playwright launches Chromium with `--no-sandbox` by default (`chromiumSandbox: false`). The container relies on container isolation and a non-root user instead of Chromium's sandbox.

The Premium-room password form has still not been captured. Auto-join fills the first visible `input[type=password]` and the text input in the same form, then submits. If that fails, or `CHATZY_PASSWORD` is unset, the bot waits for the operator over noVNC.

## 5. Architecture

```text
Discord Gateway
      |
      v
Discord adapter ---- command/permission service
      |                         |
      v                         v
              Bot coordinator
             /       |        \
            v        v         v
   relay service  command   notification
                  registry      service
            \        |         /
             v       v        v
             Chatzy browser adapter
                      |
                 Playwright
                      |
             Chromium on X display
                      |
                 Xvfb + noVNC
```

Recommended runtime stack:

- Bun as runtime, package manager, TypeScript executor, and test runner (`bun test`). No separate Node.js, npm, `tsc` build step, or Vitest is required; Bun runs `.ts` files directly.
- `discord.js` v14 for the Discord gateway and slash commands.
- Playwright for Chromium automation. The `playwright` npm package version is pinned exactly to the version of `playwright-driver` in the locked nixpkgs (currently 1.63.0) so the Nix-provided browsers are used in development.
- A Nix flake (`flake.nix`) provides the development shell: Bun, Playwright browsers via `PLAYWRIGHT_BROWSERS_PATH`, Xvfb, and x11vnc. Enter it with `nix develop` (or direnv `use flake`).
- Xvfb as Chromium's virtual display.
- x11vnc plus noVNC/websockify for manual browser access.
- Structured logging, initially to standard output for Docker collection.
- JSON files in a mounted data volume for browser state and small configuration state. SQLite can replace JSON if later features need searchable history or many mutable rules.

## 6. Proposed Project Layout

```text
src/
  index.ts
  config.ts
  logger.ts
  coordinator.ts
  chatzy/
    browser.ts
    session.ts
    selectors.ts
    watcher.ts
    parser.ts
    sender.ts
    presence.ts
    types.ts
  commands/
    registry.ts
    help.ts
    joke.ts
    relay.ts
  discord/
    client.ts
    permissions.ts
    register-commands.ts
    commands/
      relay.ts
      status.ts
      who.ts
      reload.ts
      reconnect.ts
      browser.ts
  relay/
    service.ts
    dedupe.ts
  notifications/
    joins.ts
  jokes/
    jokes.json
scripts/
  start-container.sh
tests/
  fixtures/
  unit/
  integration/
Dockerfile
docker-compose.yml
.env.example
flake.nix
flake.lock
package.json
bun.lock
tsconfig.json
```

## 7. Chatzy Browser Adapter

### 7.1 Persistent browser

Launch Chromium in headed mode with a persistent user data directory under `/data/browser-profile`. Headed mode is required even when no one is watching so the same browser can be exposed through noVNC at any time.

The bot should:

1. Open `CHATZY_ROOM_URL`.
2. Detect whether it is on the entry page, in the room, disconnected, or on an unexpected page.
3. Automatically enter the configured alias, color, and password when selectors are known and auto-join is enabled.
4. If automatic entry fails, stay on the page, mark the state as `waiting_for_operator`, and notify Discord with the private browser-control URL.
5. Start message and presence watchers only after the in-room selectors pass validation.

The password can be optional in environment configuration. An operator may always enter it manually through noVNC instead of storing it in `.env`.

### 7.2 Manual browser control

The container will run an X display and expose it through noVNC. The operator can open a web browser to the noVNC page and interact with Chromium directly to:

- Enter a room password.
- Complete a Chatzy account login.
- Respond to VPN or anti-abuse behavior.
- Reload or navigate the page.
- Inspect visible errors.

Security requirements:

- Do not expose noVNC directly to the public internet.
- Bind it to the LAN interface only, or preferably put it behind an authenticated reverse proxy, Tailscale, or WireGuard.
- Require a VNC password even on a private network.
- Do not print the room password, Chatzy cookies, Discord token, or WebSocket URL in logs.
- Do not expose Chromium's remote debugging port to the network.

Automation and manual interaction share the same browser. The bot should pause actions while the operator is using the entry/login page and automatically resume once the room is detected.

### 7.3 Message watcher

Install a `MutationObserver` on the message-log container. For each newly added `<p>`, parse a normalized event:

```ts
type ChatzyEvent =
  | { type: "message"; user: string; text: string; links: string[] }
  | { type: "join"; user: string }
  | { type: "leave"; user: string }
  | { type: "system"; text: string };
```

The browser-side observer should pass plain serializable values into the Bun process through a Playwright-exposed callback. The Bun side owns command dispatch, notification logic, and Discord calls.

At watcher startup, parse existing lines only to establish state. Do not execute historical `!` commands and do not emit historical join notifications. Process only mutations that occur after initialization.

### 7.4 Sender

All outgoing Chatzy messages pass through one queue:

- Ensure the room is connected before sending.
- Apply a conservative delay between messages to avoid rate limiting.
- Type into the visible input and submit the form or press Enter.
- Split messages safely below Chatzy's 4000-character limit.
- Reject or sanitize embedded control characters.
- Track recent bot output so the watcher does not interpret it as a user command.
- Return a useful error to Discord if sending fails.

### 7.5 Presence and joins

Take an initial snapshot of online visitors without generating notifications. Then:

- Parse `p.b` system events immediately for low-latency joins.
- Poll the visitor list periodically as a reliability fallback.
- Normalize names without altering visible punctuation, spaces, or case.
- Deduplicate `{event type, full name}` for a configurable time window.

## 8. Command Processing

### 8.1 Chatzy command registry

Only messages beginning with `!` are candidates. Split the first token as the case-insensitive command name and retain the remaining text as arguments. The registry owns command lookup and error handling.

Initial command contracts:

| Command | Result |
| --- | --- |
| `!help` | Posts a concise list of available commands |
| `!joke` | Posts one random joke from the local curated JSON file |
| `!relay <message>` | Sends the message to Discord, attributed to the Chatzy user |

`!relay` without text should post a short usage response in Chatzy. Commands from the bot's own exact alias are ignored to prevent loops.

The jokes list should be local and reviewed rather than fetched from an external API. Avoid immediately repeating the same joke; remembering the last selected index is sufficient for the first release.

### 8.2 Discord slash commands

Register commands to one development guild first so updates appear immediately. Global registration can be enabled after behavior stabilizes.

Each command must:

- Check the invoking user's configured permission policy.
- Defer the Discord response if browser interaction could take more than three seconds.
- Return ephemeral errors for permission or operational failures.
- Avoid exposing Chatzy passwords, cookies, or tokens in responses.

### 8.3 Explicit relay behavior

Chatzy to Discord:

1. A Chatzy user sends `!relay hello`.
2. The watcher parses it as a command.
3. The relay service sends `[Chatzy] <name>: hello` to the Discord relay channel.
4. The bot does not echo a success message into Chatzy unless delivery fails; this keeps room noise low.

Discord to Chatzy:

1. An authorized Discord user invokes `/relay message:hello`.
2. The relay service sends `[<Discord display name>] hello` through the Chatzy sender queue.
3. The Discord interaction receives an ephemeral success or failure response.
4. The resulting Chatzy line is ignored as bot-originated input and cannot trigger another relay.

Attachments are out of scope for the first release. A later version can append Discord CDN URLs after checking file type and size.

## 9. Connection State and Recovery

Use an explicit state machine rather than scattered booleans:

```text
starting
  -> joining
  -> connected
  -> disconnected -> reconnecting -> connected
  -> waiting_for_operator -> connected
  -> stopped
```

Recovery rules:

- Observe the page, browser process, and `#X7483` connection text.
- Reload once after a transient disconnect.
- Retry with increasing delays and jitter after repeated failures.
- Stop automatic retries at a configurable threshold and enter `waiting_for_operator` so Chatzy is not hammered.
- Notify Discord when operator action becomes necessary and when the session recovers.
- Reset message and presence baselines after reconnecting so history is not reprocessed.
- On SIGTERM, stop accepting commands, drain the sender briefly, send `/bye` or click Leave Room when connected, close Discord, and exit within Docker's stop timeout.

## 10. Configuration

Expected environment variables:

```dotenv
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=
DISCORD_RELAY_CHANNEL_ID=
DISCORD_NOTIFICATION_CHANNEL_ID=
DISCORD_ADMIN_ROLE_IDS=
DISCORD_RELAY_ROLE_IDS=

CHATZY_ROOM_URL=
CHATZY_ALIAS=Room Bot
CHATZY_COLOR=000000
CHATZY_PASSWORD=
CHATZY_AUTO_JOIN=false

NOVNC_PUBLIC_URL=
VNC_PASSWORD=
LOG_LEVEL=info
```

`CHATZY_PASSWORD` remains optional so it can be entered manually. Production secrets belong in an uncommitted `.env`, Docker secrets, or the server's secret manager. Commit only `.env.example` with empty values.

## 11. Container Design

Use the official `oven/bun` Debian image. Install Chromium and its system libraries with `bunx playwright@<pinned version> install --with-deps chromium` so the browser build matches the pinned package. Add only the Xvfb/VNC/noVNC components needed for the interactive display. Dependencies are installed with `bun install --frozen-lockfile --production` from the committed `bun.lock`.

Bun compatibility note: Playwright and discord.js are both Node-targeted libraries. Bun's Node compatibility covers them, but Playwright launching Chromium under Bun is the riskiest part of the stack and is verified first in Phase 1. If a blocking incompatibility appears, the fallback is to keep Bun as package manager/test runner and run the bot entrypoint with Node; no application code needs to change for that.

The compose service should provide:

- `restart: unless-stopped`.
- A persistent `./data:/data` volume.
- An `.env` file or secret injection.
- A noVNC port bound only to a private address.
- `shm_size` large enough for stable Chromium operation.
- A health check that verifies the Bun process and reports browser state; Docker should not restart merely because human password entry is required.
- Graceful-stop time long enough to leave the Chatzy room cleanly.

Run the application and browser as a non-root user. Avoid `--no-sandbox` unless the deployment environment makes Chromium's sandbox impossible and the risk is explicitly accepted.

## 12. Testing Strategy

### Unit tests

- Parse normal messages with names containing spaces and parentheses.
- Parse joins, leaves, and unknown system lines.
- Parse `!help`, `!joke`, and `!relay` including empty and mixed-case input.
- Ensure bot-authored messages cannot trigger commands or relays.
- Verify join deduplication and initial-presence suppression.
- Verify Discord attribution and message-length handling.

Use sanitized copies of the supplied room HTML as fixtures.

### Browser integration tests

- Load a local HTML fixture and verify MutationObserver delivery.
- Send through the fixture input and verify queue ordering.
- Simulate selector changes and verify fallback selection or an actionable failure.
- Simulate disconnect/reconnect and ensure old commands are not replayed.

### Manual acceptance test

Using the supplied test room and then the Premium room:

1. Start the container and open noVNC.
2. Manually enter credentials/password and join.
3. Confirm `/status` reports connected.
4. Join from a second browser and confirm exactly one Discord notification.
5. Send `!joke` and verify one joke appears in Chatzy.
6. Send `!relay test from Chatzy` and verify one attributed Discord message.
7. Run `/relay message:test from Discord` and verify one attributed Chatzy message.
8. Reload manually and confirm the bot recovers without replaying old commands.
9. Stop the container and confirm the bot leaves the room cleanly.

## 13. Implementation Phases

### Phase 1: Foundation and browser control

- Add the Nix flake dev shell and initialize the Bun project (`package.json`, `bun.lock`, `tsconfig.json` for editor/type checking via `bunx tsc --noEmit`), `bun test`, and configuration validation.
- Verify Playwright can launch persistent headed Chromium under Bun before building further.
- Add the Playwright/Xvfb/noVNC container runtime.
- Launch persistent headed Chromium and verify manual control.
- Implement page-state detection and selector validation.

Exit criterion: the operator can open noVNC, join Chatzy manually, and `/status` can distinguish entry page, connected room, and disconnected states.

### Phase 2: Chatzy adapter

- Implement message parsing and the live MutationObserver.
- Implement the sender queue.
- Implement online-user snapshots and join detection.
- Add reconnect and graceful shutdown behavior.

Exit criterion: a local console harness reliably receives events and sends messages in the test room without replaying page history.

### Phase 3: Discord integration

- Connect `discord.js` and register guild slash commands.
- Add permission checks.
- Implement `/status`, `/who`, `/reload`, `/reconnect`, and `/browser`.
- Post deduplicated join notifications.

Exit criterion: a Chatzy join causes exactly one Discord notice and administrative commands accurately control/report the browser.

### Phase 4: Commands and explicit relay

- Add the Chatzy command registry.
- Add the curated joke list, `!help`, and `!joke`.
- Implement Chatzy `!relay` and Discord `/relay`.
- Add sender-origin and relay-loop protection.

Exit criterion: both relay directions work only through explicit commands, and no action loops or processes historical commands.

### Phase 5: Hardening and deployment

- Add structured redacted logging and health checks.
- Run unit, fixture-browser, container, disconnect, and shutdown tests.
- Document server deployment, backups, upgrades, noVNC protection, and Discord bot setup.
- Validate behavior against the password-protected Premium room.

Exit criterion: the service survives browser/network interruption, requests operator help when necessary, and restarts with its browser profile intact.

## 14. Security and Privacy Notes

- The supplied WebSocket capture contains Chatzy account/session credentials and is ignored by Git. The existing token should still be invalidated by logging out of Chatzy.
- Never commit `.env`, browser profiles, HAR files, WebSocket captures, or Discord tokens.
- Treat relayed room messages as potentially private. Restrict the Discord channels and bot permissions accordingly.
- Escape Discord mentions from Chatzy text by default so a Chatzy user cannot trigger `@everyone`, role, or user pings through `!relay`.
- Treat Chatzy text as untrusted input. Do not evaluate it as code or interpolate it into shell commands.
- Rate-limit `!joke` and `!relay` per user and globally to prevent abuse.
- Keep the noVNC endpoint private and authenticated.

## 15. Deferred Features

- GIF and image search commands.
- Discord attachment relaying.
- Automatic or rule-based message mirroring.
- Searchable message history and persistent analytics.
- Leave notifications.
- Multiple Chatzy rooms or Discord servers.
- Direct WebSocket protocol implementation.

These can be added after the browser adapter and explicit relay path prove stable.
