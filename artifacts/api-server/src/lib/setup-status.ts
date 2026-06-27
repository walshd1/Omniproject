import type { Request } from "express";
import { getSettings, type SettingsState } from "./settings";
import { isLiveBroker } from "../broker";
import { isOidcConfigured } from "./oidc";
import { resolveCapabilities } from "./capabilities";
import { roleForReq } from "./rbac";
import { busMode } from "./notify-bus";
import { brokerLogBusMode } from "./broker-log-bus";
import { rateLimitMode } from "./rate-limit";
import { licenseSummary } from "./license";
import { auditStatus } from "./audit";
import { DEV_PERSIST_ENABLED } from "./dev-persist";

/**
 * Setup-status report — a registry of SECTIONS, each contributing a slice of the
 * `GET /api/setup/status` payload. Adding a subsystem to the first-run diagnostics
 * is one section entry, not an edit to a growing object literal (the same generic
 * registry shape the catalogues and the config loader use).
 */

interface StatusContext {
  req: Request;
  settings: SettingsState;
  /** Resolved capability set (or null when the backend can't be reached). */
  capabilities: unknown;
}

/** A subsystem's contribution to the status report (merged into the response). */
type StatusSection = (ctx: StatusContext) => Record<string, unknown>;

const SECTIONS: StatusSection[] = [
  ({ settings, req }) => ({ configured: isLiveBroker() || !!settings.brokerUrl, role: roleForReq(req) }),
  ({ settings }) => ({ broker: { configured: isLiveBroker() || !!settings.brokerUrl, urlSet: !!settings.brokerUrl } }),
  () => ({ auth: { mode: isOidcConfigured ? "oidc" : "demo" } }),
  ({ settings }) => ({ ai: { provider: settings.aiProvider } }),
  () => ({ realtime: { enabled: !!process.env["NOTIFY_INGEST_SECRET"]?.trim(), bus: busMode() } }),
  // Horizontal-scale fan-out: "redis" = shared across replicas, "in-process" =
  // per-replica. Lets an operator verify multi-replica wiring at a glance.
  () => ({ scale: { notifyBus: busMode(), brokerLogBus: brokerLogBusMode(), rateLimit: rateLimitMode() } }),
  () => ({ audit: auditStatus() }),
  () => ({ dev: { statefulDemo: DEV_PERSIST_ENABLED } }),
  () => ({ licensing: licenseSummary() }),
  ({ capabilities }) => ({ capabilities }),
];

/** Assemble the setup/status report from the registered sections. */
export async function buildSetupStatus(req: Request): Promise<Record<string, unknown>> {
  const settings = getSettings();
  const capabilities = await resolveCapabilities(req).catch(() => null);
  const ctx: StatusContext = { req, settings, capabilities };
  return Object.assign({}, ...SECTIONS.map((section) => section(ctx)));
}
