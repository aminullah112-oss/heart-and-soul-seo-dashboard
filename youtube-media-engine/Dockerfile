# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Base: Node with ffmpeg and the fonts the renderer draws with.
#
# ffmpeg is not optional — it is the render engine. The font packages matter
# too: without them every chart label and caption renders as empty boxes, and
# the failure is silent because ffmpeg and sharp both "succeed".
# ─────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-dejavu-core \
      fonts-liberation2 \
      fonts-noto-core \
      ca-certificates \
      openssl \
    && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ─────────────────────────────────────────────────────────────
# Dependencies, cached on the lockfile alone.
# ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/agents/package.json packages/agents/
COPY packages/ai/package.json packages/ai/
COPY packages/analytics/package.json packages/analytics/
COPY packages/audio/package.json packages/audio/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/images/package.json packages/images/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/research/package.json packages/research/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/video/package.json packages/video/
COPY packages/youtube/package.json packages/youtube/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @yme/database generate
RUN pnpm --filter @yme/web build

# ─────────────────────────────────────────────────────────────
# Web
# ─────────────────────────────────────────────────────────────
FROM build AS web
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Runs as a non-root user; the storage volume is chowned so renders can be
# written without granting write access to the whole image.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
CMD ["pnpm", "--filter", "@yme/web", "start"]

# ─────────────────────────────────────────────────────────────
# Worker
# ─────────────────────────────────────────────────────────────
FROM build AS worker
ENV NODE_ENV=production
RUN mkdir -p /app/storage /tmp/yme-work && chown -R node:node /app/storage /tmp/yme-work
USER node
# No healthcheck port: liveness is visible in the AutomationJob table and on
# the dashboard's health page, which is the state that actually matters.
CMD ["pnpm", "--filter", "@yme/worker", "start"]

# ─────────────────────────────────────────────────────────────
# Migration runner — run once on deploy, before starting the app.
#   docker compose run --rm migrate
# ─────────────────────────────────────────────────────────────
FROM build AS migrate
CMD ["pnpm", "--filter", "@yme/database", "deploy"]
