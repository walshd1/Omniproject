import type { Request } from "express";
import { getSettings, type SettingsState } from "./settings";
import { isLiveBroker } from "../broker";
import { builtinBackendEnabled } from "./dev-persist";
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

/** Whether a REAL source of record is wired — the ONE fact the public/outer surface needs (e.g.
 *  every session's demo-mode banner), independent of the caller's role. True for a live broker, a
 *  configured broker URL, OR the opt-in built-in backend (a real, encrypted first-party store — so
 *  its data must never be mislabelled as throwaway "demo/sample" data). */
export function brokerConfigured(): boolean {
  return isLiveBroker() || !!getSettings().brokerUrl || builtinBackendEnabled();
}

const SECTIONS: StatusSection[] = [
  ({ req }) => ({ configured: brokerConfigured(), role: roleForReq(req) }),
  ({ settings }) => ({ broker: { configured: brokerConfigured(), urlSet: !!settings.brokerUrl } }),
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

/** The "outer surface" of setup status — the one fact every authenticated session
 *  needs regardless of role (e.g. the demo-mode banner in the global chrome). The
 *  full report above carries live broker/backend/licensing state and is gated to
 *  PMO/admin at the route; this is what's passed through to everyone else instead. */
export function buildPublicSetupStatus(): { broker: { configured: boolean } } {
  return { broker: { configured: brokerConfigured() } };
}
