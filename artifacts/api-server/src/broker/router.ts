import { getBroker } from "./index";
import { brokerForCommand, type CommandIntent } from "./registry";
import { withEndpoints } from "./endpoint-context";
import type { Broker } from "./types";

/**
 * Broker router — turn the per-kind routing DECISION (`brokerForCommand`) into an
 * actual per-kind DISPATCH. Because every connected broker platform speaks the same
 * HTTP contract, the "adapter" for a kind is the one HTTP broker pointed at that
 * kind's endpoint; this module resolves the endpoint and binds the call to it.
 *
 * Per-kind endpoints are declared in `BROKER_ENDPOINTS`:
 *   BROKER_ENDPOINTS="n8n=https://n8n/webhook,node-red=http://localhost:1880/omniproject"
 * (a kind may list several URLs separated by `|` for a same-kind pool). A kind with
 * no declared endpoint falls back to the default (`BROKER_URL`) — so single-broker
 * deployments are unchanged.
 */

/** Parse the `BROKER_ENDPOINTS` env string into a `kind → urls` map. First occurrence of a kind
 *  wins (mirrors the original scan-and-early-return behaviour, including the edge case where a
 *  first match with no urls after filtering resolves to `undefined` even if a later duplicate
 *  would have parsed to something non-empty). */
function parseEndpoints(raw: string): Map<string, string[] | undefined> {
  const map = new Map<string, string[] | undefined>();
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const k = pair.slice(0, eq).trim().toLowerCase();
    if (map.has(k)) continue; // first match wins
    const urls = pair.slice(eq + 1).split("|").map((u) => u.trim()).filter(Boolean);
    map.set(k, urls.length ? urls : undefined);
  }
  return map;
}

/** Memoized on the raw env value, so a hot-reloaded/changed BROKER_ENDPOINTS still re-parses (just
 *  not on every routed call — was re-parsing the whole string per call; see
 *  docs/PERF-PATTERNS-REVIEW.md, Theme B). */
let endpointsCache: { raw: string; map: Map<string, string[] | undefined> } | undefined;

/** The endpoint URL(s) declared for a broker kind, or undefined if none. */
export function endpointsForKind(kind: string): string[] | undefined {
  const raw = process.env["BROKER_ENDPOINTS"]?.trim();
  if (!raw) return undefined;
  if (!endpointsCache || endpointsCache.raw !== raw) endpointsCache = { raw, map: parseEndpoints(raw) };
  return endpointsCache.map.get(kind.toLowerCase());
}

/**
 * Route a broker call to the kind that should serve it. Picks the kind via the
 * registry decision, binds the broker to that kind's endpoint (if one is declared)
 * for the duration of `fn`, and runs it. The broker instance is the active HTTP
 * adapter — the uniform contract is what lets one adapter serve every kind.
 */
export async function routeBrokerCall<T>(intent: CommandIntent, fn: (broker: Broker) => Promise<T>): Promise<T> {
  const kind = brokerForCommand(intent);
  const endpoints = endpointsForKind(kind);
  const broker = getBroker();
  return endpoints ? withEndpoints(endpoints, () => fn(broker)) : fn(broker);
}
