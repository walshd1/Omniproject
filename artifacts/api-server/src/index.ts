import app from "./app";
import { logger } from "./lib/logger";
import { brokerKind } from "./broker";
import { isOidcConfigured } from "./lib/oidc";
import { getSettings } from "./lib/settings";
import { installShutdownHandlers } from "./lib/shutdown";
import { initBrokerLogBus, brokerLogBusMode } from "./lib/broker-log-bus";
import { loadConfigDir } from "./lib/config-dir";

// Load this deployment's config directory (OMNI_CONFIG_DIR) BEFORE serving, so the
// vendor overlay + settings from the operator's folder of JSON are in place when
// the first request lands. No-op when the env var is unset.
loadConfigDir();

// Start the broker-log fan-out at boot so this replica begins RECEIVING the
// fleet's live entries immediately (not just emitting its own). In-process unless
// REDIS_URL is set — see lib/broker-log-bus.ts.
initBrokerLogBus();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info(
    {
      port,
      dataMode: brokerKind() === "demo" ? "demo (sample data)" : brokerKind(),
      auth: isOidcConfigured ? "oidc" : "demo",
      aiProvider: getSettings().aiProvider,
      brokerLogBus: brokerLogBusMode(),
    },
    "Server listening",
  );
});

// Clean up on SIGTERM/SIGINT: drain SSE streams, finish in-flight requests, exit.
installShutdownHandlers(server, logger);
