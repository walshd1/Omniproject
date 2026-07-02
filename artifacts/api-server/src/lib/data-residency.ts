import { recordAudit } from "./audit";
import { configuredBrokerUrls } from "./broker-url";
import {
  residencyPolicyState, policyRegionForUrl, policyAllowedRegions, policyEgressAllowed,
  type ResidencyPolicy,
} from "./residency-policy";

/**
 * Data-residency / region routing — a fail-closed guard at the broker seam AND the egress hop.
 *
 * A regulated customer needs a hard promise that work for a region never leaves it. Because
 * OmniProject is stateless, the only place data crosses a boundary is the outbound broker hop,
 * so that hop is where the boundary is enforced: every resolved broker endpoint is tagged with
 * a region, the deployment declares which region(s) are allowed, and a call to an endpoint
 * outside the allowed set is REFUSED (451) before any bytes egress, with an audit event.
 *
 * Two configuration forms, checked in that order:
 *   1. `DATA_RESIDENCY_POLICY` — a validated JSON policy mapping `region → { backends, egress }`
 *      for multinationals that pin several jurisdictions in one deployment (see residency-policy.ts).
 *      When present it also gates EGRESS: an outbound host outside every allowed region's egress
 *      allowlist is refused. An invalid policy fails CLOSED (it cannot prove residency).
 *   2. The flat env pair below — the original single-deployment "which regions" model.
 *
 * Opt-in and behaviour-preserving by default: with neither `DATA_RESIDENCY_POLICY` nor
 * `DATA_RESIDENCY_ALLOWED` set the guard is OFF and nothing is checked. When on it is FAIL-CLOSED —
 * a resolved endpoint with no declared region, or a region not in the allowed set, is refused (an
 * unprovable region can't be trusted).
 *
 * Config (env):
 *   DATA_RESIDENCY_POLICY    JSON per-country policy (supersedes the two below when set).
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

/** Is region enforcement configured? (A JSON policy — even an invalid one — or DATA_RESIDENCY_ALLOWED.) */
export function dataResidencyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const pol = residencyPolicyState(env);
  if (pol.policy || pol.error) return true;
  return !!env["DATA_RESIDENCY_ALLOWED"]?.trim();
}

/** The allowed region codes (lower-cased), as a set. The JSON policy's `allowed` wins when present. */
export function allowedRegions(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const pol = residencyPolicyState(env);
  if (pol.policy) return policyAllowedRegions(pol.policy);
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

/** The declared region for an endpoint URL (longest-prefix match), or null if undeclared. The JSON
 *  policy's `backends` win when a policy is present; otherwise the flat `DATA_RESIDENCY_MAP`. */
export function regionForUrl(url: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const pol = residencyPolicyState(env);
  if (pol.policy) return policyRegionForUrl(pol.policy, url.trim());
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
  const pol = residencyPolicyState(env);
  // An invalid policy can't prove residency ⇒ refuse everything (fail-closed).
  if (pol.error) return { allowed: false, reason: `data-residency policy is invalid: ${pol.error} (fail-closed)` };
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

/**
 * Check an outbound host against the per-country egress allowlist. Only the JSON policy carries an
 * egress dimension, so when no policy is set this is a no-op ALLOW (the legacy env model and every
 * default deployment are unchanged). Pure — no audit/throw — for reuse by tests and the status view.
 */
export function checkEgressResidency(host: string, env: NodeJS.ProcessEnv = process.env): ResidencyVerdict {
  const pol = residencyPolicyState(env);
  if (pol.error) return { allowed: false, reason: `data-residency policy is invalid: ${pol.error} (fail-closed)` };
  if (!pol.policy) return { allowed: true };
  if (policyEgressAllowed(pol.policy, host)) return { allowed: true };
  return { allowed: false, reason: `egress host '${host}' is not permitted by any allowed region's egress policy` };
}

/**
 * Enforce the per-country egress policy on an outbound URL's host: audit + throw a 451
 * DataResidencyError BEFORE the request egresses when a policy is active and the host is not in any
 * allowed region's egress allowlist. No-op when no JSON policy is configured. Called from the egress
 * guard (`assertEgressAllowed`), so EVERY outbound hop — broker, IdP, FX, AI, logging — is covered.
 */
export function assertEgressResidency(url: string, env: NodeJS.ProcessEnv = process.env): void {
  const pol = residencyPolicyState(env);
  if (!pol.policy && !pol.error) return; // no policy ⇒ egress residency is inert
  let host: string;
  try { host = new URL(url).hostname; } catch { return; } // scheme/URL validity is the egress guard's job
  const verdict = checkEgressResidency(host, env);
  if (verdict.allowed) return;
  recordAudit({
    ts: new Date().toISOString(),
    category: "broker",
    action: "data_residency.egress_block",
    write: true,
    result: "error",
    meta: { host, reason: verdict.reason },
  });
  throw new DataResidencyError(verdict.reason ?? "blocked by the data-residency egress policy", url);
}

export interface ResidencyStatus {
  enabled: boolean;
  allowedRegions: string[];
  endpoints: { origin: string; region: string | null; allowed: boolean }[];
  /** Which configuration form is active: the JSON per-country policy, the flat env pair, or none. */
  mode: "policy" | "env" | "off";
  /** Present only in `policy` mode: the declared regions with their backends + egress rules. */
  regions?: { code: string; allowed: boolean; backends: string[]; egress: string[] }[];
  /** Present only when the JSON policy failed to parse/validate (the seam is failing closed). */
  policyError?: string;
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
  const pol = residencyPolicyState(env);
  const mode: ResidencyStatus["mode"] = pol.policy || pol.error ? "policy" : enabled ? "env" : "off";
  const out: ResidencyStatus = { enabled, allowedRegions: [...allow], endpoints, mode };
  if (pol.error) out.policyError = pol.error;
  if (pol.policy) out.regions = regionSummary(pol.policy, allow);
  return out;
}

/** Collapse a policy's region map into the status view's region list (declared order preserved). */
function regionSummary(policy: ResidencyPolicy, allow: Set<string>): NonNullable<ResidencyStatus["regions"]> {
  return Object.entries(policy.regions).map(([code, rule]) => ({
    code, allowed: allow.has(code), backends: rule.backends, egress: rule.egress,
  }));
}
