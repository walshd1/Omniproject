# syntax=docker/dockerfile:1
#
# OmniProject "omni-shell" — single container that serves both the brutalist
# SPA and the n8n proxy gateway on one port (3000). This is the image that
# docker-compose.standalone.yml, docker-compose.enterprise.yml and
# k8s-enterprise-manifest.yaml all deploy.

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# Install dependencies against the committed lockfile for reproducible builds.
COPY . .
RUN pnpm install --frozen-lockfile

# Build the SPA (vite.config reads PORT + BASE_PATH at config-eval time) and the
# self-contained API server bundle.
ENV NODE_ENV=production
RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/omniproject run build \
 && pnpm --filter @workspace/api-server run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
# The gateway serves the built SPA from here (single-container mode).
ENV STATIC_DIR=/app/public

WORKDIR /app

# Self-contained esbuild bundle + pino worker sidecar files.
COPY --from=builder /app/artifacts/api-server/dist ./dist
# Built static frontend.
COPY --from=builder /app/artifacts/omniproject/dist/public ./public

EXPOSE 3000
USER node

# Liveness/readiness probes target /api/healthz on this port.
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
