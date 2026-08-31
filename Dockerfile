# syntax=docker/dockerfile:1

# ---------- deps: install node modules + download Chromium ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
COPY package.json package-lock.json ./
RUN npm ci

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

# System libraries required by headless Chromium, plus headless LibreOffice for
# the "any file → PDF" converter (Word / Excel / PowerPoint / ODF / RTF …).
# LibreOffice adds ~350 MB; drop the three libreoffice-* packages if you only
# need the brochure builder and image/PDF conversion.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation fonts-noto-color-emoji fonts-noto-cjk \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
      libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
      libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 \
      libdrm2 xdg-utils \
      libreoffice-writer libreoffice-calc libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r app && useradd -r -g app -m app

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.cache/puppeteer /app/.cache/puppeteer

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
