# OmniStore — the first-party, stateful BACKEND container. Build from the REPO ROOT (it shares the
# gateway's broker wire-contract + crypto libs):
#     docker build -f services/omnistore/Dockerfile -t omniproject-omnistore .
#
# It speaks the broker sidecar wire contract, so any broker points at it:
#   BROKER_URL=http://omnistore:5702           (n8n / reference broker)
#   BUILTIN_BROKER=sidecar SQL_SIDECAR_URL=…    (the built-in broker's HTTP client)
#
# Pinned by digest (not just the mutable tag) — same base as the gateway so the runtimes can't
# silently drift; refresh together on a version bump.
FROM node:26-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c

RUN npm install -g pnpm@11.8.0
WORKDIR /app

# Install the workspace against the committed lockfile (reproducible). tsx (a pinned devDependency)
# runs the TypeScript directly — the service is small + I/O-bound, so a bundle step buys little.
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts

ENV NODE_ENV=production
ENV PORT=5702
# Durable, encrypted, chain-verified store lives here — mount a persistent, backed-up volume.
# (Unset ⇒ in-memory with a loud warning; the operator owns backups/DR — see docs/design/STATEFUL-SIDECAR.md.)
ENV OMNISTORE_FILE=/var/lib/omnistore/store.sealed
RUN mkdir -p /var/lib/omnistore && chown -R 1000:1000 /var/lib/omnistore

EXPOSE 5702
USER 1000:1000
# The sidecar contract is POST-only; a bare GET returns 405, which is a fine liveness signal.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5702),{method:'GET'}).then(r=>process.exit(r.status===405?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/artifacts/api-server
CMD ["pnpm", "run", "omnistore"]
