# syntax=docker/dockerfile:1

# ---------- deps: install node modules (no browser download) ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Render's build network can't reliably pull Chrome from Google's CDN, so we use
# Debian's `chromium` package in the runner instead — skip Puppeteer's download.
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder: compile the Next.js app ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner: minimal image that serves the app ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bind to all interfaces so PaaS hosts (Railway / Render) can route to it.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Point Puppeteer at the system Chromium installed below.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# `chromium` pulls in all the shared libs Chrome needs (no guessing), plus fonts
# and headless LibreOffice for the "any file → PDF" converter. LibreOffice adds
# ~350 MB — drop the libreoffice-* lines if you don't need that feature.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates chromium \
      fonts-liberation fonts-freefont-ttf fonts-noto-color-emoji fonts-noto-cjk \
      libreoffice-writer libreoffice-calc libreoffice-impress \
    && rm -rf /var/lib/apt/lists/* \
    && chromium --version

RUN groupadd -r app && useradd -r -g app -m app

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
