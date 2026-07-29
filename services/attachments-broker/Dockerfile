# Attachments-broker service image. Build from the REPO ROOT:
#   docker build -f services/attachments-broker/Dockerfile -t omniproject-attachments-broker .
#
# Pinned by digest, not just a mutable tag — this is a byte-holding service, so an unnoticed upstream tag
# repoint is exactly the supply-chain risk to close. Same digest as the root + retention-broker images so
# the runtimes can't silently drift; refresh together on a real version bump
# (`docker buildx imagetools inspect node:26-bookworm-slim`).
FROM node:26-bookworm-slim@sha256:e999d087492c7227c85adc70574cf9d3cce774c3e6d7b8dfe473ee6b142c8f2c

WORKDIR /app/services/attachments-broker

# Zero runtime dependencies (node built-ins only) — nothing to install, so no npm ci, no lockfile, no
# third-party supply-chain surface at all. Just the source.
COPY services/attachments-broker/ ./

# The blob volume. Bytes live ONLY here (a mounted, writable volume), so the container can run with a
# read-only root filesystem. `node` owns it so a non-root process can write.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
ENV PORT=8091
ENV ATTACHMENTS_BROKER_DIR=/data
EXPOSE 8091
USER node
# Liveness probe against the unauthenticated /healthz endpoint (bearer auth gates only /blob/*).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8091)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
