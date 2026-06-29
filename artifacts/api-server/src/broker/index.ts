import type { Request, Response } from "express";
import { getSession } from "../routes/auth";
import { sessionBindFromSession } from "../lib/session-key";
import { roleForReq } from "../lib/rbac";
import { N8nBroker, N8N_ENV_CONFIGURED, pingBroker } from "./n8n";
import { DemoBroker } from "./demo";
import { BrokerError, type Broker, type ActorContext } from "./types";
import { instrumented, wrapWithTrace } from "./trace";
import { provenanceEnabled, wrapWithProvenance } from "./provenance";
import { wrapWithKeyGuard } from "./key-guard";
import { isDevMode } from "../lib/dev-mode";
import { DataResidencyError } from "../lib/data-residency";
import { devBrokerFromEnv } from "./dev-broker";
import { applyVendorProfile, demoVendorFor } from "./vendor-profile";
import { readCacheEnabled, wrapWithCache, invalidateReadCache } from "./cache";
import { getSettings } from "../lib/settings";

/**
 * Broker selection + the request→domain context adapter.
 *
 * `getBroker()` picks the implementation ONCE: the n8n adapter when a backend is
 * wired (BROKER_URL), else the demo adapter. Everything above this module
 * imports `getBroker()` and the `Broker` interface — never a concrete adapter.
 */

let singleton: Broker | null = null;

/** The active broker (n8n when configured, else demo). Selected once. When the
 *  trace gate is open (non-prod + BROKER_TRACE=1) it is wrapped so every method
 *  call is logged at the seam; in production the wrap is never applied. */
export function getBroker(): Broker {
  if (!singleton) {
    // Dev-only: the dev broker presents AS a chosen vendor over a chosen data
    // source (demo/bundle/cassette) for testing without a real backend. Null
    // outside dev mode, so production is unaffected.
    const dev = devBrokerFromEnv();
    let base: Broker = dev ?? (N8N_ENV_CONFIGURED ? new N8nBroker() : new DemoBroker());
    // Keyed-access posture: a LIVE broker is hard-gated behind a configured key
    // (BROKER_PSK) outside dev mode — no keyless request reaches a real vendor/broker.
    // Innermost so a cache hit (which reaches no broker) isn't blocked. Demo/dev brokers
    // serve sample data and reach no vendor, so they're exempt.
    if (N8N_ENV_CONFIGURED && !dev && !isDevMode()) base = wrapWithKeyGuard(base);
    // Demonstration flavour: present the demo AS the vendor named by `backendSource`,
    // gated to its declared capabilities, so a prospect previews the product on THEIR
    // stack over sample data. `demoVendorFor` enforces the hard rule that a thin-file
    // spoof NEVER appears over real data — it returns null when a real backend is
    // connected (prod) or the dev broker is active, so only real vendors show in prod.
    const demoVendor = demoVendorFor({ devActive: !!dev, realBackend: N8N_ENV_CONFIGURED, source: getSettings().backendSource });
    if (demoVendor) base = applyVendorProfile(base, demoVendor);
    // OPT-IN performance mode: a short-TTL in-memory read cache (READ_CACHE_TTL_MS).
    // Trades "never stale" for latency; off by default and announced loudly at boot.
    if (readCacheEnabled()) base = wrapWithCache(base);
    // Provenance: chained, keyed-MAC fingerprints of every broker call (content stays
    // in transit; only MACs persist). Outside the cache so logical calls are recorded
    // even on a cache hit. Additive — never alters results.
    if (provenanceEnabled()) base = wrapWithProvenance(base);
    singleton = instrumented() ? wrapWithTrace(base) : base;
  }
  return singleton;
}

/** Drop the cached broker so the next getBroker() rebuilds it — used when the dev
 *  broker config is switched on the fly. Also clears any read cache. */
export function resetBroker(): void {
  invalidateReadCache();
  singleton = null;
}

/** Test a backend connection through the active broker, or null if unsupported. */
export function brokerVerifyConnection(ctx: ActorContext, backend: string): Promise<{ ok: boolean; detail?: string }> | null {
  const b = getBroker();
  return typeof b.verifyConnection === "function" ? b.verifyConnection(ctx, backend) : null;
}

/** Delegate a credential to the broker's vault, or null if the broker has none. */
export function brokerStoreCredential(ctx: ActorContext, input: { backend: string; name: string; value: string }): Promise<{ stored: boolean; ref?: string }> | null {
  const b = getBroker();
  return typeof b.storeCredential === "function" ? b.storeCredential(ctx, input) : null;
}

/** Diagnostics: "n8n" | "demo". */
export function brokerKind(): string {
  return getBroker().kind;
}

/** True when the active broker is backed by a real backend (not demo). */
export function isLiveBroker(): boolean {
  return getBroker().live;
}

/**
 * Generic command passthrough — forward an arbitrary action + payload through the
 * n8n adapter's command edge. This lives in the broker barrel (the seam) so the
 * adapter import stays here; the command edges above the seam (`/broker/command`,
 * the raw escape hatch) call THIS instead of importing the adapter themselves.
 * The generic command is an n8n-adapter concern (not on the neutral Broker
 * interface), so it always uses an N8nBroker bound to the configured webhook.
 */
const commandBroker = new N8nBroker();
/** Forward an arbitrary action + payload through the adapter's command edge. */
export function brokerCommand(ctx: ActorContext, action: string, payload: Record<string, unknown>, source: string): Promise<unknown> {
  // Arbitrary commands may mutate the backend, and they bypass the cached broker —
  // so drop any cached reads so a change made here is visible immediately.
  invalidateReadCache();
  return commandBroker.commandWithSource(ctx, action, payload, source);
}

/**
 * Readiness: can this replica reach its backend? The demo/in-process broker has
 * no external dependency, so it is always ready; a live broker is pinged (bounded)
 * to confirm reachability. Result is briefly cached so a readiness probe loop
 * (k8s every ~10s, or a noisy caller) can't hammer the broker.
 */
export interface BrokerReadiness { ready: boolean; kind: string; status?: number; detail?: string }
let readyCache: { at: number; result: BrokerReadiness } | null = null;
const READY_TTL_MS = 5_000;

/** Probe (and briefly cache) whether this replica can reach its backend. */
export async function brokerReadiness(timeoutMs = 2000): Promise<BrokerReadiness> {
  if (readyCache && Date.now() - readyCache.at < READY_TTL_MS) return readyCache.result;
  const kind = brokerKind();
  let result: BrokerReadiness;
  if (!isLiveBroker()) {
    result = { ready: true, kind };
  } else {
    const p = await pingBroker(timeoutMs);
    result = { ready: p.reachable, kind, ...(p.status !== undefined ? { status: p.status } : {}), ...(p.detail ? { detail: p.detail } : {}) };
  }
  readyCache = { at: Date.now(), result };
  return result;
}

/** Test-only: drop the readiness cache. */
export function resetReadinessCache(): void {
  readyCache = null;
}

/** Build the domain ActorContext (forwarded identity + transport auth) from a request. */
export function contextFromReq(req: Request): ActorContext {
  const session = getSession(req);
  const explicit = req.headers?.["authorization"];
  const authHeader = explicit
    ? Array.isArray(explicit) ? explicit[0] : explicit
    : session?.accessToken ? `Bearer ${session.accessToken}` : undefined;
  if (!session) return { authHeader };
  // Bind the per-session broker signing key to this user + session (null for older
  // cookies that predate the scheme — those fall back to the static broker key).
  const sessionBind = sessionBindFromSession(session) ?? undefined;
  return { sub: session.sub, email: session.email, name: session.name, role: roleForReq(req), token: session.accessToken, authHeader, sessionBind, actorKind: "human" };
}

/**
 * Run a broker capability that may be UNSUPPORTED by the active broker, mapping the two failure
 * shapes the connection routes all repeated: a null promise ⇒ 501 (the broker doesn't offer
 * this capability), a thrown error ⇒ 502. On success returns the resolved value; on either
 * failure it sends the response and returns null (the caller returns). `unsupported`/`failed`
 * carry the route-specific bodies.
 */
export async function callBrokerCapability<T>(
  capability: Promise<T> | null,
  res: Response,
  bodies: { unsupported: Record<string, unknown>; failed: (message: string) => Record<string, unknown> },
): Promise<T | null> {
  if (!capability) {
    res.status(501).json(bodies.unsupported);
    return null;
  }
  try {
    return await capability;
  } catch (err) {
    res.status(502).json(bodies.failed(err instanceof Error ? err.message : "request failed"));
    return null;
  }
}

/** Map a thrown broker error onto an HTTP response (status from the taxonomy). */
export function respondBrokerError(res: Response, err: unknown): void {
  if (err instanceof DataResidencyError) {
    // A residency refusal is a policy block, not a backend failure — 451 (legal reasons).
    res.status(451).json({ error: err.message, code: "data_residency" });
    return;
  }
  if (err instanceof BrokerError) {
    const body: Record<string, unknown> = { error: err.message };
    if (err.code === "conflict" && err.details) body["current"] = err.details;
    res.status(err.status).json(body);
    return;
  }
  const isTimeout = err instanceof Error && err.name === "TimeoutError";
  res.status(502).json({ error: isTimeout ? "backend request timed out" : "backend unreachable" });
}

export { BrokerError } from "./types";
export type {
  Broker, ActorContext, Project, Issue, IssueWrite, Summary, HistoryPoint, HistoryState, Baseline,
  PortfolioRow, FxRates, CapabilityFlags, VerifyReport, Row, BrokerErrorCode,
} from "./types";
