# syntax=docker/dockerfile:1
#
# OmniProject "omni-shell" — single container that serves both the brutalist
# SPA and the n8n proxy gateway on one port (3000). This is the image that
# docker-compose.standalone.yml, docker-compose.enterprise.yml and
# k8s-enterprise-manifest.yaml all deploy.

# ── Builder ───────────────────────────────────────────────────────────────────
# Mirror the CI toolchain (.github/workflows/ci.yml): Node 26 + pnpm 11.8.0 — CI now verifies on
# Node 26 too (the SPA test env needed a localStorage polyfill, since Node 26's built-in Web Storage
# collides with jsdom's — see artifacts/omniproject/src/test/setup.ts). Keep these in lockstep: if you
# bump either version here, bump the matching one in ci.yml (node-version / pnpm/action-setup's
# `version:`) so the build and CI toolchains can't silently drift apart.
#
# Pinned by digest, not just the `26-bookworm-slim` tag: a tag is mutable (the same tag name
# gets repointed at a new image on every Debian/Node patch release), so pinning only by tag
# means every build silently pulls whatever the tag currently resolves to — not reproducible,
# and a compromised/tampered upstream tag would go unnoticed. Refresh the digest deliberately
# (e.g. `docker buildx imagetools inspect node:26-bookworm-slim`) alongside a real version bump.
FROM node:26-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c AS builder

# Node no longer bundles corepack, so install the pinned pnpm directly via npm.
RUN npm install -g pnpm@11.8.0

WORKDIR /app

# Install dependencies against the committed lockfile for reproducible builds.
# --ignore-scripts mirrors CI and avoids pnpm 11's fatal ERR_PNPM_IGNORED_BUILDS;
# esbuild's binary ships in its @esbuild/linux-x64 platform package, so no
# dependency install script is needed for the build to work.
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build the SPA (vite.config reads PORT + BASE_PATH at config-eval time) and the
# self-contained API server bundle.
ENV NODE_ENV=production
RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/omniproject run build \
 && pnpm --filter @workspace/api-server run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:26-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c AS runtime

ENV NODE_ENV=production
ENV PORT=3000
# The gateway serves the built SPA from here (single-container mode).
ENV STATIC_DIR=/app/public

WORKDIR /app

# Self-contained esbuild bundle + pino worker sidecar files — `*.mjs` only, deliberately
# excluding the sibling `*.map` files the build emits (esbuild's `sourcemap: "linked"` embeds
# the full original TypeScript source in each one). Shipping them into the image would put
# readable source on disk for no runtime benefit — the error handler never returns a stack
# trace to a client (lib/error-handler.ts), and nothing here serves ./dist statically, so the
# maps would have no legitimate reader once the build is done.
COPY --from=builder /app/artifacts/api-server/dist/*.mjs ./dist/
# Built static frontend.
COPY --from=builder /app/artifacts/omniproject/dist/public ./public

EXPOSE 3000
USER node

# Liveness/readiness probes target /api/healthz on this port. No --enable-source-maps: the
# runtime image ships no .map files (see above), so it would be a no-op; keeping it off avoids
# a future re-add of the maps silently starting to reference them.
CMD ["node", "dist/index.mjs"]
