# Retention-broker service image. Build from the REPO ROOT (it shares the gateway's pure retention
# algebra): docker build -f services/retention-broker/Dockerfile -t omniproject-retention-broker .
#
# Pinned by digest, not just a mutable tag — this is the one image that holds live cloud credentials,
# so an unnoticed upstream tag repoint is exactly the supply-chain risk to close. Same digest as the
# root Dockerfile so the two runtimes can't silently drift; refresh both together on a real version
# bump (`docker buildx imagetools inspect node:26-bookworm-slim`).
FROM node:26-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c

WORKDIR /app

# The service's own manifest + lockfile (its cloud SDKs are isolated from the pnpm workspace).
# `npm ci` (no fallback) installs strictly from the lockfile — integrity-checked and reproducible —
# and includes tsx (the runtime loader, a pinned devDependency), so no separate unpinned install is
# needed. A `|| npm install` fallback would silently defeat lockfile integrity on any drift, in an
# image that holds live cloud credentials.
COPY services/retention-broker/package.json services/retention-broker/package-lock.json ./services/retention-broker/
RUN cd services/retention-broker && npm ci

# The service source + the gateway's pure history algebra it imports (SDK-free, shared for one source
# of truth on the key/query layout).
COPY services/retention-broker/ ./services/retention-broker/
COPY artifacts/api-server/src/history/ ./artifacts/api-server/src/history/

WORKDIR /app/services/retention-broker
# tsx runs the TS directly (installed above from the lockfile); the service is small and I/O-bound, so
# a build step buys little.
ENV PORT=8090
EXPOSE 8090
USER node
# Liveness probe against the unauthenticated /healthz endpoint (bearer auth gates only /retention/*).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/server.ts"]
