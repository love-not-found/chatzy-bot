FROM oven/bun:1.4.2-debian AS web-build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY web ./web
COPY src ./src
RUN bun run build:web

FROM oven/bun:1.4.2-debian

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DISPLAY=:99 \
    DATA_DIR=/data \
    CONFIG_DIR=/config \
    WEBUI_PORT=3000 \
    HEALTH_PORT=8080

# Virtual display + VNC/noVNC for manual browser control, tini as init.
RUN apt-get -o Acquire::Retries=3 update \
 && apt-get -o Acquire::Retries=3 -o Acquire::http::Pipeline-Depth=0 install -y --no-install-recommends \
      tini xvfb x11vnc novnc websockify \
      fonts-liberation fonts-noto-color-emoji ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Chromium build matching the pinned playwright version, plus its system libraries.
RUN bunx playwright install --with-deps --no-shell chromium \
 && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY --from=web-build /app/web/dist ./web/dist

RUN mkdir -p /data /config && chown -R bun:bun /data /config && chmod +x scripts/start-container.sh
USER bun

EXPOSE 6080 3000
VOLUME ["/data", "/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||8080)).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "/app/scripts/start-container.sh"]
