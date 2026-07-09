# Retention-broker service image. Build from the REPO ROOT (it shares the gateway's pure retention
# algebra): docker build -f services/retention-broker/Dockerfile -t omniproject-retention-broker .
FROM node:22-slim

WORKDIR /app

# The service's own manifest + lockfile (its cloud SDKs are isolated from the pnpm workspace).
COPY services/retention-broker/package.json services/retention-broker/package-lock.json ./services/retention-broker/
RUN cd services/retention-broker && npm ci --omit=dev || npm install --omit=dev

# The service source + the gateway's pure history algebra it imports (SDK-free, shared for one source
# of truth on the key/query layout).
COPY services/retention-broker/ ./services/retention-broker/
COPY artifacts/api-server/src/history/ ./artifacts/api-server/src/history/

WORKDIR /app/services/retention-broker
# tsx runs the TS directly; the service is small and I/O-bound, so a build step buys little.
RUN npm install --no-save tsx@^4.19.0
ENV PORT=8090
EXPOSE 8090
USER node
CMD ["npx", "tsx", "src/server.ts"]
