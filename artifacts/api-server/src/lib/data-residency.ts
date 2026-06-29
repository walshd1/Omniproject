import { recordAudit } from "./audit";
import { configuredBrokerUrls } from "./broker-url";

/**
 * Data-residency / region routing — a fail-closed guard at the broker seam.
 *
 * A regulated customer needs a hard promise that work for a region never leaves it. Because
 * OmniProject is stateless, the only place data crosses a boundary is the outbound broker hop,
 * so that hop is where the boundary is enforced: every resolved broker endpoint is tagged with
 * a region, the deployment declares which region(s) are allowed, and a call to an endpoint
 * outside the allowed set is REFUSED (451) before any bytes egress, with an audit event.
 *
 * Opt-in and behaviour-preserving by default: with `DATA_RESIDENCY_ALLOWED` unset the guard is
 * OFF and nothing is checked. When set it is FAIL-CLOSED — a resolved endpoint with no declared
 * region, or a region not in the allowed set, is refused (an unprovable region can't be trusted).
 *
 * Config (env):
 *   DATA_RESIDENCY_ALLOWED   comma list of allowed region codes (e.g. "eu" or "eu,uk").
 *                            Unset ⇒ enforcement OFF.
 *   DATA_RESIDENCY_MAP       comma list of `urlPrefix=region` pairs, e.g.
 *                            "https://eu.n8n.example=eu,https://us.n8n.example=us".
 *                            An endpoint takes the region of its LONGEST matching prefix.
 */

/** A 451 (Unavailable For Legal Reasons) — the request would cross a residency boundary. */
export class DataResidencyError extends Error {
  readonly statusCode = 451 as const;
  readonly expose = true as const;
  readonly url: string | undefined;
  constructor(message: string, url?: string) {
    super(message);
    this.name = "DataResidencyError";
    this.url = url;
  }
}

/** Is region enforcement configured? (DATA_RESIDENCY_ALLOWED present.) */
export function dataResidencyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env["DATA_RESIDENCY_ALLOWED"]?.trim();
}

/** The allowed region codes (lower-cased), as a set. */
export function allowedRegions(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env["DATA_RESIDENCY_ALLOWED"]?.trim() ?? "";
  return new Set(raw.split(",").map((r) => r.trim().toLowerCase()).filter(Boolean));
}

interface PrefixRegion { prefix: string; region: string }

/** Parse DATA_RESIDENCY_MAP into prefix→region pairs, longest prefix first. */
function regionMap(env: NodeJS.ProcessEnv): PrefixRegion[] {
  const raw = env["DATA_RESIDENCY_MAP"]?.trim();
  if (!raw) return [];
  const out: PrefixRegion[] = [];
  for (const pair of raw.split(",")) {
    const eq = pair.lastIndexOf("=");
    if (eq < 0) continue;
    const prefix = pair.slice(0, eq).trim();
    const region = pair.slice(eq + 1).trim().toLowerCase();
    if (prefix && region) out.push({ prefix, region });
  }
  return out.sort((a, b) => b.prefix.length - a.prefix.length);
}

/** The declared region for an endpoint URL (longest-prefix match), or null if undeclared. */
export function regionForUrl(url: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const u = url.trim();
  for (const { prefix, region } of regionMap(env)) {
    if (u.startsWith(prefix)) return region;
  }
  return null;
}

export interface ResidencyVerdict {
  allowed: boolean;
  url?: string;
  region?: string | null;
  reason?: string;
}

/**
 * Verify every candidate endpoint sits in an allowed region. Pure (no side effects) so it can
 * be unit-tested and reused by the status view. Returns the FIRST offending endpoint. When
 * enforcement is off, everything is allowed.
 */
export function checkResidency(urls: string[], env: NodeJS.ProcessEnv = process.env): ResidencyVerdict {
  if (!dataResidencyEnabled(env)) return { allowed: true };
  const allow = allowedRegions(env);
  for (const url of urls) {
    const region = regionForUrl(url, env);
    if (region === null) {
      return { allowed: false, url, region: null, reason: "endpoint has no declared region (fail-closed)" };
    }
    if (!allow.has(region)) {
      return { allowed: false, url, region, reason: `region '${region}' is not in the allowed set {${[...allow].join(", ")}}` };
    }
  }
  return { allowed: true };
}

/**
 * Enforce residency on the resolved endpoint pool: on a violation, audit the block and throw a
 * 451 DataResidencyError BEFORE any request egresses. No-op when enforcement is off (so the
 * default deployment is unchanged). Called from the broker adapter's endpoint resolver, the one
 * place every outbound call passes through.
 */
export function assertResidency(urls: string[], env: NodeJS.ProcessEnv = process.env): void {
  const verdict = checkResidency(urls, env);
  if (verdict.allowed) return;
  recordAudit({
    ts: new Date().toISOString(),
    category: "broker",
    action: "data_residency.block",
    write: true,
    result: "error",
    meta: { url: verdict.url, region: verdict.region, reason: verdict.reason },
  });
  throw new DataResidencyError(verdict.reason ?? "blocked by the data-residency policy", verdict.url);
}

export interface ResidencyStatus {
  enabled: boolean;
  allowedRegions: string[];
  endpoints: { origin: string; region: string | null; allowed: boolean }[];
}

/** Admin status view: the policy + every configured broker endpoint's region + allow verdict.
 *  Endpoints are reduced to their ORIGIN so a secret webhook path is never surfaced. */
export function residencyStatus(env: NodeJS.ProcessEnv = process.env): ResidencyStatus {
  const enabled = dataResidencyEnabled(env);
  const allow = allowedRegions(env);
  const endpoints = configuredBrokerUrls(env).map((url) => {
    const region = regionForUrl(url, env);
    let origin = url;
    try { origin = new URL(url).origin; } catch { /* keep raw if unparseable */ }
    return { origin, region, allowed: !enabled || (region !== null && allow.has(region)) };
  });
  return { enabled, allowedRegions: [...allow], endpoints };
}
