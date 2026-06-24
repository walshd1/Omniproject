import type { Request, Response } from "express";
import { getSession } from "../routes/auth";
import { roleForReq } from "../lib/rbac";
import { N8nBroker, N8N_ENV_CONFIGURED } from "./n8n";
import { DemoBroker } from "./demo";
import { BrokerError, type Broker, type ActorContext } from "./types";

/**
 * Broker selection + the request→domain context adapter.
 *
 * `getBroker()` picks the implementation ONCE: the n8n adapter when a backend is
 * wired (N8N_WEBHOOK_URL), else the demo adapter. Everything above this module
 * imports `getBroker()` and the `Broker` interface — never a concrete adapter.
 */

let singleton: Broker | null = null;

/** The active broker (n8n when configured, else demo). Selected once. */
export function getBroker(): Broker {
  if (!singleton) singleton = N8N_ENV_CONFIGURED ? new N8nBroker() : new DemoBroker();
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
  Broker, ActorContext, Project, Issue, IssueWrite, Summary, HistoryPoint, Baseline,
  PortfolioRow, FxRates, CapabilityFlags, VerifyReport, Row, BrokerErrorCode,
} from "./types";
