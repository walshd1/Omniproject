import type { Request, Response } from "express";
import { getSession } from "../routes/auth";
import { roleForReq } from "../lib/rbac";
import { N8nBroker, N8N_ENV_CONFIGURED, pingBroker } from "./n8n";
import { DemoBroker } from "./demo";
import { BrokerError, type Broker, type ActorContext } from "./types";
import { instrumented, wrapWithTrace } from "./trace";

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
    const base: Broker = N8N_ENV_CONFIGURED ? new N8nBroker() : new DemoBroker();
    singleton = instrumented() ? wrapWithTrace(base) : base;
  }
  return singleton;
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
  return { sub: session.sub, email: session.email, name: session.name, role: roleForReq(req), token: session.accessToken, authHeader };
}

/** Map a thrown broker error onto an HTTP response (status from the taxonomy). */
export function respondBrokerError(res: Response, err: unknown): void {
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
