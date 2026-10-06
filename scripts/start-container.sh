#!/bin/sh
# Container entrypoint: virtual display, optional VNC/noVNC, then the bot.
set -eu

SCREEN_SIZE="${SCREEN_SIZE:-1280x800x24}"
DISPLAY_NUM="${DISPLAY#:}"

rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"
Xvfb "$DISPLAY" -screen 0 "$SCREEN_SIZE" -nolisten tcp >/dev/null 2>&1 &

i=0
while [ ! -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; do
  i=$((i + 1))
  if [ "$i" -gt 100 ]; then echo "Xvfb did not start" >&2; exit 1; fi
  sleep 0.1
done

# Saved /config settings take precedence over the initial environment seed.
VNC_PASSWORD=$(bun src/scripts/vnc-config.ts)
if [ -n "${VNC_PASSWORD:-}" ]; then
  mkdir -p "$HOME/.vnc"
  x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null 2>&1
  # VNC itself only listens inside the container; noVNC is the only exposed port.
  x11vnc -display "$DISPLAY" -rfbauth "$HOME/.vnc/passwd" -localhost -rfbport 5900 \
    -forever -shared -quiet >/dev/null 2>&1 &
  websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
  echo "Manual browser control: http://<server>:6080/vnc.html"
else
  echo "VNC_PASSWORD is not set: manual browser control is DISABLED." >&2
fi

# Allow overriding the command, e.g. `docker compose run chatzy-bot bun src/scripts/console.ts`.
if [ "$#" -gt 0 ]; then exec "$@"; fi
exec bun src/index.ts
