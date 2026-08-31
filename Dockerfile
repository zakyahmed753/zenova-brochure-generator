# syntax=docker/dockerfile:1

# ---------- deps: install node modules + download the matching Chrome ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
# Skip the flaky postinstall download; do a clean, retried install right after so
# a half-finished download can't leave a broken cache the build then trips over.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
RUN set -e; \
    for i in 1 2 3 4; do \
      npx --yes puppeteer browsers install chrome && break; \
      echo ">> chrome download attempt $i failed — clearing and retrying"; \
      npx --yes puppeteer browsers clear || true; \
      sleep 8; \
    done; \
    CHROME="$(find /app/.cache/puppeteer -type f -name chrome | head -1)"; \
    test -n "$CHROME"; \
    echo "chrome downloaded: $CHROME"

# ---------- builder: compile the Next.js app ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.cache ./.cache
COPY . .
RUN npm run build

# ---------- runner: minimal image that serves the app ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
# Bind to all interfaces so PaaS hosts (Railway / Render) can route to it.
# PORT is overridden by the platform at runtime; 3000 is just the local default.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Full runtime dependency set for headless Chrome (the short list leaves Chrome
# to hang/crash on some pages — libatspi/libxss/libxtst are the usual missing
# ones), plus headless LibreOffice for the "any file → PDF" converter.
# LibreOffice adds ~350 MB; drop the libreoffice-* lines if you don't need it.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation fonts-freefont-ttf fonts-noto-color-emoji fonts-noto-cjk \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libc6 libcairo2 \
      libcups2 libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libgbm1 libgcc-s1 \
      libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
      libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
      libxdamage1 libxext6 libxfixes3 libxi6 libxkbcommon0 libxrandr2 libxrender1 \
      libxshmfence1 libxss1 libxtst6 libvulkan1 xdg-utils \
      libreoffice-writer libreoffice-calc libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r app && useradd -r -g app -m app

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.cache/puppeteer /app/.cache/puppeteer

# Fail the build (not production) if the Chrome binary didn't make it into the image.
RUN CHROME="$(find /app/.cache/puppeteer -type f -name chrome | head -1)"; \
    if [ -n "$CHROME" ]; then echo "chrome in image: $CHROME"; else echo "chrome MISSING"; exit 1; fi

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
