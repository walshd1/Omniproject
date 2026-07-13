/**
 * Server entrypoint. Resolves KMS-wrapped root keys + durable state (bootstrap), loads the
 * deployment config directory, starts the broker-log bus, then listens — and wires graceful
 * shutdown. The Express app itself is built in ./app; this file only orchestrates boot order.
 */
import app, { bootstrap } from "./app";
import { logger } from "./lib/logger";
import { brokerKind, getBroker } from "./broker";
import { isOidcConfigured } from "./lib/oidc";
import { getSettings } from "./lib/settings";
import { installShutdownHandlers } from "./lib/shutdown";
import { initBrokerLogBus, brokerLogBusMode } from "./lib/broker-log-bus";
import { initPresenceBus, presenceBusMode } from "./lib/presence-bus";
import { startAiKillFleetSync } from "./lib/ai-kill";
import { refreshMaintenanceFromShared, startMaintenanceFleetSync } from "./lib/maintenance";
import { startKeyRegistryFleetSync, refreshKeyRegistryFromShared } from "./lib/key-registry";
import { startScimFleetSync, refreshScimFromShared } from "./lib/scim";
import { startExecDigestScheduler, runExecDigest } from "./lib/exec-digest";
import { startProactiveDigestScheduler, runProactiveDigest } from "./lib/proactive-digest";
import { startScheduledExportScheduler, runScheduledExport } from "./lib/scheduled-export";
import { startDriftCanaryScheduler, runDriftCanary } from "./lib/drift-canary";
import { loadConfigDir } from "./lib/config-dir";
import { readCacheEnabled, readCacheTtlMs } from "./broker/cache";
import { startMetricExport } from "./lib/otlp-metrics";

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

// Loudly announce the opt-in read cache — it relaxes the stateless "never stale"
// guarantee, so an operator must see it at boot in any environment.
if (readCacheEnabled()) {
  logger.warn(
    { ttlMs: readCacheTtlMs() },
    `[read-cache] ON (TTL=${readCacheTtlMs()}ms): reads may be up to this stale — the zero-drift guarantee is relaxed. Writes invalidate the cache; data is held in RAM per-replica only. Unset READ_CACHE_TTL_MS to disable.`,
  );
}

// Async boot: resolve KMS-wrapped root keys + durable state FIRST (so the at-rest crypto is
// ready), THEN read the config directory and the broker-log bus, THEN serve. A KMS/unwrap
// failure is logged (not fatal) inside bootstrap(); a hard config-read failure surfaces here.
async function start(): Promise<void> {
  await bootstrap();

  // Load this deployment's config directory (OMNI_CONFIG_DIR) BEFORE serving, so the vendor
  // overlay + settings from the operator's folder of JSON are in place when the first request
  // lands. Runs after bootstrap() so a KMS-wrapped config key is already unwrapped.
  loadConfigDir();

  // Start the broker-log fan-out so this replica begins RECEIVING the fleet's live entries
  // immediately. In-process unless REDIS_URL is set — see lib/broker-log-bus.ts.
  initBrokerLogBus();

  // Start the presence fan-out so this replica begins RECEIVING the fleet's presence changes
  // (rosters + editing indicators). In-process unless REDIS_URL is set — see lib/presence-bus.ts.
  initPresenceBus();

  // Converge the AI kill-switch with shared state on an interval, so engaging the break-glass control on
  // ANY replica takes effect here — fleet-wide when REDIS_URL is set, per-replica otherwise (unref'd).
  startAiKillFleetSync();

  // Same for the maintenance/break-glass read-only lockdown: converge once now (so a freeze already
  // active on the fleet is adopted before this replica serves), then poll — so a lockdown engaged on
  // ANY replica freezes writes here too, not just on the replica that served the toggle. Redis-backed
  // when REDIS_URL is set; a no-op single-replica convergence otherwise (the durable local file stands).
  void refreshMaintenanceFromShared();
  startMaintenanceFleetSync();

  // Same for key/session revocation: push any revocations restored from the sealed state file (loaded in
  // bootstrap) up to shared state now, then converge on an interval — so a credential revoked on ANY
  // replica takes effect fleet-wide (Redis) rather than lingering until each replica reloads.
  void refreshKeyRegistryFromShared();
  startKeyRegistryFleetSync();

  // Same for the SCIM directory: push the sealed-file-restored directory up to shared now, then
  // converge on an interval — so an IdP deprovision (active=false) landing on ANY replica denies the
  // user at the gate fleet-wide (Redis) rather than lingering until each replica reloads its directory.
  void refreshScimFromShared();
  startScimFleetSync();

  // Optional single-instance scheduled executive digest (off unless EXEC_DIGEST_INTERVAL_HOURS>0;
  // for a fleet, use the trigger endpoint + an external scheduler so it fires once).
  startExecDigestScheduler(() => runExecDigest({ now: Date.now(), broker: getBroker() }));

  // Optional OTLP metrics push (off unless OTEL_EXPORTER_OTLP_ENDPOINT is set) — additive to the
  // always-on /api/metrics Prometheus scrape and the W3C-trace/OTLP span export. Interval-driven,
  // unref'd, best-effort.
  startMetricExport();

  // Proactive "what needs me" digest — ON by a safe weekly default (opt-out): set
  // PROACTIVE_DIGEST_INTERVAL_HOURS=0 to disable, or to a custom cadence. Single-instance timer;
  // for a fleet, set it to 0 and drive POST /api/admin/proactive-digest/run from external cron so
  // it fires once. A healthy portfolio yields an empty digest that is skipped, so "on" ≠ "noisy".
  startProactiveDigestScheduler(() => runProactiveDigest({ now: Date.now(), broker: getBroker() }));
  startScheduledExportScheduler(() => runScheduledExport({ now: Date.now(), broker: getBroker() }));

  // Third-party API drift canary — ON by a safe 6-hourly default (opt-out): set
  // DRIFT_CANARY_INTERVAL_HOURS=0 to disable, or to a custom cadence. Diffs the broker's
  // read-only verify probe (and field enumeration, where supported) against the last run so a
  // vendor API regression raises an alert instead of surfacing as a silent failure later.
  // Single-instance timer; for a fleet, set it to 0 and drive POST /api/admin/drift-canary/run
  // from external cron so it fires once. A quiet run dispatches nothing.
  startDriftCanaryScheduler(() => runDriftCanary({ now: Date.now(), broker: getBroker() }));

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
        presenceBus: presenceBusMode(),
      },
      "Server listening",
    );
  });

  // Clean up on SIGTERM/SIGINT: drain SSE streams, finish in-flight requests, exit.
  installShutdownHandlers(server, logger);
}

start().catch((err) => {
  logger.error({ err }, "Fatal error during boot");
  process.exit(1);
});
