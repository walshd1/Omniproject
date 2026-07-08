import type { Request } from "express";
import { getSettings, type PeerInstance } from "./settings";
import { allowedRegions } from "./data-residency";
import { computeLocalPortfolioSummary, type PortfolioSummary } from "./portfolio-summary";
import { logger } from "./logger";
import { isTimeoutError } from "./timeout-error";

/**
 * Cross-instance portfolio federation (backlog #135) — a minimal, stateless fan-out that lets a
 * multinational running one OmniProject instance per region/subsidiary (the shape per-country data
 * residency, backlog #97, pushes them toward) see a consolidated global view WITHOUT centralising any
 * project data. Only the `PortfolioSummary` aggregate (see lib/portfolio-summary.ts) ever crosses an
 * instance boundary — never raw project/issue records — and every contribution is kept separately
 * labeled by peer/region rather than blended into one number, so a reader always knows which region
 * contributed what (the same residency-transparency stance as docs/DATA-RESIDENCY.md).
 *
 * Auth: this instance calls the peer's OWN existing `GET /portfolio/summary` using a plain bearer
 * token that must be one of the PEER's `API_TOKENS` (lib/api-token.ts) — the read-only API-token
 * scheme that already exists for BI-style consumers. No new cross-instance auth scheme.
 */

const PEER_TIMEOUT_MS = 8_000;

export type PeerFetchStatus = "ok" | "unreachable" | "unauthorized" | "error";

export interface PeerPortfolioResult {
  id: string;
  label: string;
  region: string | null;
  status: PeerFetchStatus;
  summary: PortfolioSummary | null;
  error?: string;
  ms: number;
}

export interface FederatedPortfolio {
  generatedAt: string;
  local: { label: string; region: string | null; summary: PortfolioSummary };
  peers: PeerPortfolioResult[];
}

/**
 * Fetch one peer's local portfolio summary. Best-effort and NEVER throws: an unreachable/misconfigured
 * peer degrades to a labeled "unavailable" contribution (status ≠ "ok", summary null) instead of
 * failing the whole federated view — the same posture as the outbound-webhook delivery fan-out
 * (lib/webhooks.ts's `deliverOne`) and an FX-rate fallback.
 */
export async function fetchPeerSummary(peer: PeerInstance): Promise<PeerPortfolioResult> {
  const base = { id: peer.id, label: peer.label, region: peer.region ?? null };
  const url = `${peer.baseUrl.replace(/\/+$/, "")}/api/portfolio/summary`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${peer.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: "unauthorized", summary: null, error: `HTTP ${res.status}`, ms };
    }
    if (!res.ok) {
      return { ...base, status: "error", summary: null, error: `HTTP ${res.status}`, ms };
    }
    const summary = (await res.json()) as PortfolioSummary;
    return { ...base, status: "ok", summary, ms };
  } catch (err) {
    const ms = Date.now() - started;
    const isTimeout = isTimeoutError(err);
    return { ...base, status: "unreachable", summary: null, error: isTimeout ? "timed out" : "unreachable", ms };
  }
}

/** How this instance labels its OWN contribution in a federated view — an env override, else a plain
 *  default; region derives from the residency policy's allowed-region set when one is configured (no
 *  new config needed just for this label). */
function localIdentity(): { label: string; region: string | null } {
  const label = process.env["FEDERATION_SELF_LABEL"]?.trim() || "This instance";
  const allowed = allowedRegions();
  const region = allowed.size ? [...allowed].sort().join(",") : null;
  return { label, region };
}

/**
 * Build the combined federated view: this instance's own summary + every ACTIVE configured peer's,
 * fetched live and in parallel. Stateless — nothing is cached beyond the peer config itself
 * (settings.federatedPeers); every call re-fans-out.
 */
export async function buildFederatedPortfolio(req: Request): Promise<FederatedPortfolio> {
  const peers = (getSettings().federatedPeers ?? []).filter((p) => p.active);
  const [summary, peerResults] = await Promise.all([
    computeLocalPortfolioSummary(req),
    Promise.all(peers.map((p) => fetchPeerSummary(p))),
  ]);
  for (const r of peerResults) {
    if (r.status !== "ok") {
      logger.warn({ peerId: r.id, peerLabel: r.label, status: r.status, error: r.error, ms: r.ms }, "federated_portfolio_peer_unavailable");
    }
  }
  return { generatedAt: new Date().toISOString(), local: { ...localIdentity(), summary }, peers: peerResults };
}
