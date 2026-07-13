import type { Request, Response } from "express";
import { getSession } from "../routes/auth";
import { sessionBindFromSession } from "../lib/session-key";
import { roleForReq, scopeForReq } from "../lib/rbac";
import { ReferenceBroker, BROKER_ENV_CONFIGURED, pingBroker } from "./reference-broker";
import { builtinBrokerEnabled, makeBuiltinBroker } from "./builtin";
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
import { wrapWithAutonomousGuard } from "./autonomous-guard";
import { wrapWithScopeGuard } from "./scope-guard";
import { wrapWithSingleFlight } from "./single-flight";
import { messyDataArmed, wrapWithMessy } from "./messy-broker";
import { getSettings } from "../lib/settings";
import { isTimeoutError } from "../lib/timeout-error";

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
    // The built-in broker (opt-in, off by default): an in-process broker over a pluggable store
    // (memory / Postgres) — a real first-party backend for an org with no external system. A real
    // BROKER_URL and the dev broker both take precedence; when neither is set and BUILTIN_BROKER is
    // on, it replaces the sample-data demo with a real (empty) store.
    const builtinActive = !dev && !BROKER_ENV_CONFIGURED && builtinBrokerEnabled();
    let base: Broker = dev ?? (BROKER_ENV_CONFIGURED ? new ReferenceBroker() : builtinActive ? makeBuiltinBroker() : new DemoBroker());
    // ALWAYS ON, innermost: bound every autonomous-actor write to its admin-declared grant (the
    // fail-closed authorizeAutonomousWrite gate). A no-op for human contexts, so normal writes are
    // unaffected; placed closest to the real broker so no outer wrapper can route a write around it.
    base = wrapWithAutonomousGuard(base);
    // Keyed-access posture: a LIVE broker is hard-gated behind a configured key
    // (BROKER_PSK) outside dev mode — no keyless request reaches a real vendor/broker.
    // Innermost so a cache hit (which reaches no broker) isn't blocked. Demo/dev brokers
    // serve sample data and reach no vendor, so they're exempt; the built-in broker reaches no
    // external vendor either (its store is local), so it's exempt too.
    if (BROKER_ENV_CONFIGURED && !dev && !isDevMode()) base = wrapWithKeyGuard(base);
    // Demonstration flavour: present the demo AS the vendor named by `backendSource`,
    // gated to its declared capabilities, so a prospect previews the product on THEIR
    // stack over sample data. `demoVendorFor` enforces the hard rule that a thin-file
    // spoof NEVER appears over real data — it returns null when a real backend is
    // connected (prod) or the dev broker is active; the built-in broker holds REAL data, so a
    // vendor spoof must never wrap it either.
    const demoVendor = builtinActive ? null : demoVendorFor({ devActive: !!dev, realBackend: BROKER_ENV_CONFIGURED, source: getSettings().backendSource });
    if (demoVendor) base = applyVendorProfile(base, demoVendor);
    // ALWAYS ON: coalesce concurrent identical reads into one upstream call (single-flight).
    // Introduces no staleness — coalesced callers all get the one live result — so it's safe to
    // keep on unconditionally, and it shields the backend's rate limits from a thundering herd.
    // Inner to the cache so a cache hit never reaches it.
    base = wrapWithSingleFlight(base);
    // OPT-IN performance mode: a short-TTL in-memory read cache (READ_CACHE_TTL_MS).
    // Trades "never stale" for latency; off by default and announced loudly at boot.
    if (readCacheEnabled()) base = wrapWithCache(base);
    // Provenance: chained, keyed-MAC fingerprints of every broker call (content stays
    // in transit; only MACs persist). Outside the cache so logical calls are recorded
    // even on a cache hit. Additive — never alters results.
    if (provenanceEnabled()) base = wrapWithProvenance(base);
    // DEV-ONLY chaos: inject real-world imperfections into the read model so we can see
    // how resilient our reports/derivations are to dirty data. Outermost data transform
    // (sees the final rows), but inside the trace so a trace shows the messified payload.
    // `messyDataArmed()` is false in production, so this wrap is never applied there.
    if (messyDataArmed()) base = wrapWithMessy(base);
    // Defense in depth: for the FIRST-PARTY brokers OmniProject scopes for itself (demo + built-in
    // store), re-enforce the caller's data scope at the seam so a MISSING gateway guard can't leak
    // cross-scope project data. Outermost functional wrapper so it also covers a read-cache hit (the
    // cache is keyed by method+args, not by scope). A real external broker enforces the forwarded scope
    // itself (PSK envelope) and is not wrapped. No-op for all-scope / system callers.
    if (!BROKER_ENV_CONFIGURED && !dev) base = wrapWithScopeGuard(base);
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
 * Is there a broker endpoint to forward a command to? True when one is configured
 * at boot (`BROKER_URL` ⇒ `isLiveBroker()`) OR set at runtime by an admin via
 * settings. The ReferenceBroker command edges resolve their webhook from
 * `getSettings().brokerUrl` first (it takes precedence over the env), so an
 * admin-configured URL is reachable without a restart — this gate just has to
 * agree with that precedence instead of looking only at the boot-time env.
 */
export function brokerConfigured(): boolean {
  return isLiveBroker() || !!getSettings().brokerUrl?.trim();
}

/**
 * Generic command passthrough — forward an arbitrary action + payload through the
 * n8n adapter's command edge. This lives in the broker barrel (the seam) so the
 * adapter import stays here; the command edges above the seam (`/broker/command`,
 * the raw escape hatch) call THIS instead of importing the adapter themselves.
 * The generic command is an n8n-adapter concern (not on the neutral Broker
 * interface), so it always uses a ReferenceBroker bound to the configured webhook.
 */
// Wrapped with the SAME always-on autonomous-write guard as getBroker()'s base — the generic command
// edge forwards arbitrary mutating actions, so leaving it unwrapped would let an autonomous actor route
// a write around the guard (defeating "innermost, so no wrapper routes a write around it"). No-op for
// human contexts, so route traffic (all human) is unaffected.
const commandBroker = wrapWithAutonomousGuard(new ReferenceBroker());
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

/**
 * The reference adapter's verify probe, exposed through the seam for `/setup/verify-workflow`
 * (which points at an admin-supplied candidate URL, not necessarily the active broker) —
 * see broker/reference-broker for what "probe" means (PSK-aware, bounded fan-out, dry-run).
 */
export { probeVerifiableActions } from "./reference-broker";

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
  return { sub: session.sub, email: session.email, name: session.name, role: roleForReq(req), scope: scopeForReq(req), token: session.accessToken, authHeader, sessionBind, actorKind: "human" };
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

/**
 * Run a route body and, on any throw, log it once (with the given message + optional context) and
 * map the error to an HTTP response via `respondBrokerError`. The single home for the
 * try/catch/log/respond block that every broker-backed route handler otherwise repeats verbatim.
 */
export async function withBrokerErrors(
  req: Request,
  res: Response,
  message: string,
  body: () => void | Promise<void>,
  ctx: Record<string, unknown> = {},
): Promise<void> {
  try {
    await body();
  } catch (err) {
    req.log.error({ err, ...ctx }, message);
    respondBrokerError(res, err);
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
  const isTimeout = isTimeoutError(err);
  res.status(502).json({ error: isTimeout ? "backend request timed out" : "backend unreachable" });
}

export { BrokerError } from "./types";
export type {
  Broker, ActorContext, Project, Issue, IssueWrite, Summary, HistoryPoint, HistoryState, Baseline,
  PortfolioRow, FxRates, CapabilityFlags, VerifyReport, Row, BrokerErrorCode,
} from "./types";
