/**
 * Server entrypoint. Resolves KMS-wrapped root keys + durable state (bootstrap), loads the
 * deployment config directory, starts the broker-log bus, then listens — and wires graceful
 * shutdown. The Express app itself is built in ./app; this file only orchestrates boot order.
 */
import app, { bootstrap } from "./app";
import { logger } from "./lib/logger";
import { brokerKind } from "./broker";
import { isOidcConfigured } from "./lib/oidc";
import { getSettings } from "./lib/settings";
import { installShutdownHandlers } from "./lib/shutdown";
import { initBrokerLogBus, brokerLogBusMode } from "./lib/broker-log-bus";
import { initPresenceBus, presenceBusMode } from "./lib/presence-bus";
import { startAiKillFleetSync } from "./lib/ai-kill";
import { refreshMaintenanceFromShared, startMaintenanceFleetSync } from "./lib/maintenance";
import { refreshAiAuthzFromShared, startAiAuthzFleetSync } from "./lib/security-state";
import { startKeyRegistryFleetSync, refreshKeyRegistryFromShared } from "./lib/key-registry";
import { startScimFleetSync, refreshScimFromShared } from "./lib/scim";
import { startRulesDispatcher } from "./lib/rules-dispatcher";
import { registerScheduledJobs } from "./lib/register-scheduled-jobs";
import { startJobScheduler } from "./lib/job-scheduler";
import { enforceReleaseProvenanceAtBoot } from "./lib/release-provenance";
import { runSignedMigrations } from "./lib/release-migration";
import { loadConfigDir } from "./lib/config-dir";
import { assertSessionSecretForLocalPrincipals } from "./lib/session-secret-guard";
import { localUsersActive } from "./lib/user-directory";
import { readCacheEnabled, readCacheTtlMs } from "./broker/cache";
import { startMetricExport } from "./lib/otlp-metrics";
import { installProcessGuards } from "./lib/process-guards";
import { configureServerTimeouts } from "./lib/server-timeouts";

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
  // Release provenance (docs/UPDATE-MECHANISM.md §4) — verify this build is a signed, attested release
  // before doing ANY work. Off by default (RELEASE_VERIFY unset); `strict` refuses to boot an unattested
  // or tampered build (fail-closed), `warn` logs and continues.
  enforceReleaseProvenanceAtBoot();

  await bootstrap();

  // Load this deployment's config directory (OMNI_CONFIG_DIR) BEFORE serving, so the vendor
  // overlay + settings from the operator's folder of JSON are in place when the first request
  // lands. Runs after bootstrap() so a KMS-wrapped config key is already unwrapped.
  loadConfigDir();

  // Signed migration runner (docs/UPDATE-MECHANISM.md §8) — after provenance verify + data load, before
  // serving. Runs only migrations named in a manifest signed by the release trust root, snapshotting first
  // (§6). No-op when nothing is registered; in strict verify mode an unsigned/unlisted pending migration is
  // fatal (fail-closed).
  runSignedMigrations();

  // SECURITY: the import-time SESSION_SECRET guard (app.ts) ran BEFORE the store loaded, so it could not see
  // native local accounts — a real password login that may have been bootstrapped while the env still read as
  // "demo". Now that the directory is loaded, refuse to serve on the public default secret if a real local
  // principal exists (this also transitively protects the at-rest master key, which derives from SESSION_SECRET).
  assertSessionSecretForLocalPrincipals(localUsersActive());

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

  // Same for the AI-authorization controls (autonomous write-grants, containment relax-floor,
  // approved-actions allowlist): converge once now, then poll — so a grant revoked / containment
  // tightened / action un-approved on ANY replica takes effect here too, not just where it was
  // served. Redis-backed when REDIS_URL is set; a no-op single-replica converge otherwise (the
  // durable local security-state file stands). The shared blob is validated on the way in.
  void refreshAiAuthzFromShared();
  startAiAuthzFleetSync();

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

  // Optional OTLP metrics push (off unless OTEL_EXPORTER_OTLP_ENDPOINT is set) — additive to the
  // always-on /api/metrics Prometheus scrape and the W3C-trace/OTLP span export. Interval-driven,
  // unref'd, best-effort.
  startMetricExport();

  // Rules engine (event half) — subscribe the dispatcher to domain events so enabled recipes fire on real
  // changes. No-op unless RULES_ENGINE_EVENTS is set; inform-only (mutating recipes need the autonomous-grant
  // path). The time half (schedule-triggered recipes) is registered with the unified job scheduler below.
  startRulesDispatcher();

  // Unified job scheduler — the ONE place recurring background work is driven. Register every job (the exec /
  // proactive digests, scheduled export, drift canary — each opt-out/opt-in by its own *_INTERVAL_HOURS — plus
  // the schedule-triggered automation recipes), then start the single heartbeat. Each occurrence is claim-once
  // (shared-KV CAS), so the timer is SAFE on every replica; set SCHEDULER_HEARTBEAT_MINUTES=0 to disable it and
  // drive the jobs from an external cron instead. Digests stay silent when a portfolio is healthy.
  registerScheduledJobs();
  startJobScheduler();

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

  // Slowloris / slow-body defence + optional concurrent-connection cap (env-tunable). Applies to request
  // RECEIPT only, so long-lived SSE responses are unaffected.
  configureServerTimeouts(server);

  // Clean up on SIGTERM/SIGINT: drain SSE streams, finish in-flight requests, exit.
  installShutdownHandlers(server, logger);
}

// Deploy-layer admission preflight (docs/UPDATE-MECHANISM.md §4). `node dist/index.mjs --verify-release`
// runs the SAME provenance verification as boot — signature + promote-by-digest admission — and EXITS,
// without starting the server. Run it as a Kubernetes init container (and/or the image entrypoint) so an
// unsigned or wrong-digest image fails closed at the boundary, before the app container ever serves: strict
// + failure exits non-zero (the init container fails → the pod never starts the app); warn/off pass through
// with the same semantics as boot. This makes the in-process boot check enforceable one layer out.
if (process.argv.includes("--verify-release")) {
  enforceReleaseProvenanceAtBoot(); // strict + failure ⇒ process.exit(1) inside
  logger.info("release preflight passed — provenance admitted");
  process.exit(0);
}

// Crash backstop: an escaped throw / unhandled rejection is logged and SURVIVED, not fatal (see
// lib/process-guards). Installed before boot so it also covers an async boot failure.
installProcessGuards(logger);

start().catch((err) => {
  logger.error({ err }, "Fatal error during boot");
  process.exit(1);
});
