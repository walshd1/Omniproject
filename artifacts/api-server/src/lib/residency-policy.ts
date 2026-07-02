import { v, ValidationError, type Infer } from "./validate";

/**
 * Per-country / per-region data-residency POLICY — the declarative form of the residency guard.
 *
 * The flat env model (`DATA_RESIDENCY_ALLOWED` + `DATA_RESIDENCY_MAP`) answers "which regions may
 * this deployment reach". A multinational (Compliance + CISO) needs more: a single deployment that
 * serves several jurisdictions, each pinned to its OWN backends AND its own egress hosts, so German
 * work can only reach EU infrastructure and US work only US infrastructure. This module is that
 * richer policy — a validated JSON document mapping `region → { backends, egress }`:
 *
 *   {
 *     "regions": {
 *       "eu": { "backends": ["https://eu.n8n.example"], "egress": ["*.eu.example.com"] },
 *       "us": { "backends": ["https://us.n8n.example"], "egress": ["*.us.example.com"] }
 *     },
 *     "allowed": ["eu"]            // regions this deployment permits; omit ⇒ every declared region
 *   }
 *
 * It is PURE + side-effect free (no audit, no throwing except on parse) so the whole policy language
 * is unit-testable; `data-residency.ts` is the seam that enforces it and `egress.ts` the egress hop.
 *
 * Fail-closed everywhere: an invalid policy, an endpoint whose region is undeclared, or an egress
 * host matching no allowed region is REFUSED — an unprovable region can never be trusted. Configured
 * via `DATA_RESIDENCY_POLICY` (a JSON string); unset ⇒ this layer is inert and the legacy env model
 * (and the default single-region behaviour) is completely unchanged.
 */

/** One region's allowed infrastructure: broker backends (URL prefixes) + egress hosts (patterns). */
export interface RegionRule {
  /** Allowed broker endpoint URL prefixes for this region (e.g. `https://eu.n8n.example`). */
  backends: string[];
  /** Allowed egress host patterns: an exact host or a `*.suffix` wildcard. */
  egress: string[];
}

/** A validated per-country residency policy: the region map + the deployment's allowed set. */
export interface ResidencyPolicy {
  regions: Record<string, RegionRule>;
  /** Region codes this deployment permits. Always populated after parsing (defaults to all keys). */
  allowed: string[];
}

const REGION_CODE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const REGION_RULE = v.object({
  backends: v.array(v.string({ trim: true, min: 1, max: 512 }), { min: 1, max: 64 }),
  egress: v.array(v.string({ trim: true, min: 1, max: 256 }), { max: 128 }),
});

type ParsedRule = Infer<typeof REGION_RULE>;

/**
 * Validate an untrusted value as a residency policy. Returns the normalised policy, or throws
 * {@link ValidationError} with human-readable, path-qualified issues. Region codes are lower-cased;
 * `allowed` defaults to every declared region and every listed code must be declared (fail-closed:
 * you cannot allow a region you did not define). Each backend must be an `http(s)` prefix.
 */
export function validateResidencyPolicy(value: unknown): ResidencyPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(["policy must be an object"]);
  }
  const raw = value as Record<string, unknown>;
  if (!raw["regions"] || typeof raw["regions"] !== "object" || Array.isArray(raw["regions"])) {
    throw new ValidationError(["policy.regions must be an object of region-code → rule"]);
  }
  const issues: string[] = [];
  const regions: Record<string, RegionRule> = {};
  for (const [code, rule] of Object.entries(raw["regions"] as Record<string, unknown>)) {
    const key = code.trim().toLowerCase();
    if (!REGION_CODE.test(key)) { issues.push(`policy.regions: '${code}' is not a valid region code`); continue; }
    let parsed: ParsedRule;
    try { parsed = REGION_RULE(rule, `policy.regions.${key}`); }
    catch (e) { if (e instanceof ValidationError) { issues.push(...e.issues); continue; } throw e; }
    for (const b of parsed.backends) {
      if (!/^https?:\/\//i.test(b)) issues.push(`policy.regions.${key}.backends: '${b}' must be an http(s) URL prefix`);
    }
    regions[key] = { backends: parsed.backends, egress: parsed.egress.map((h) => h.toLowerCase()) };
  }
  if (issues.length) throw new ValidationError(issues);
  if (Object.keys(regions).length === 0) throw new ValidationError(["policy.regions must declare at least one region"]);

  let allowed: string[];
  if (raw["allowed"] === undefined) {
    allowed = Object.keys(regions);
  } else {
    allowed = v.array(v.string({ trim: true, min: 1, max: 32 }), { max: 64 })(raw["allowed"], "policy.allowed").map((r) => r.toLowerCase());
    for (const r of allowed) if (!regions[r]) issues.push(`policy.allowed: region '${r}' is not declared in policy.regions`);
    if (issues.length) throw new ValidationError(issues);
  }
  return { regions, allowed: [...new Set(allowed)] };
}

/** The result of loading the policy from config: the parsed policy, or the parse/validation error. */
export type PolicyState =
  | { policy: null; error: null }
  | { policy: ResidencyPolicy; error: null }
  | { policy: null; error: string };

let cache: { raw: string; state: PolicyState } | null = null;

/**
 * Load + validate the policy from `DATA_RESIDENCY_POLICY` (a JSON string), memoised by raw text so
 * the hot broker/egress paths don't re-parse. Unset/blank ⇒ inert (`{ policy: null }`). Malformed
 * JSON or an invalid policy ⇒ an `error` state so the seam can FAIL CLOSED (an unparseable policy
 * cannot prove residency, so nothing may egress under it).
 */
export function residencyPolicyState(env: NodeJS.ProcessEnv = process.env): PolicyState {
  const raw = env["DATA_RESIDENCY_POLICY"]?.trim() ?? "";
  if (!raw) return { policy: null, error: null };
  if (cache && cache.raw === raw) return cache.state;
  let state: PolicyState;
  try {
    state = { policy: validateResidencyPolicy(JSON.parse(raw)), error: null };
  } catch (e) {
    const msg = e instanceof ValidationError ? e.issues.join("; ") : e instanceof Error ? e.message : "unparseable JSON";
    state = { policy: null, error: msg };
  }
  cache = { raw, state };
  return state;
}

/** The host component of a URL/prefix, lower-cased, or null if it has no parseable host. */
function hostOf(urlOrPrefix: string): string | null {
  try { return new URL(urlOrPrefix).hostname.replace(/^\[|\]$/g, "").toLowerCase(); }
  catch { return null; }
}

/** The declared region for a backend URL under a policy (longest matching `backends` prefix wins). */
export function policyRegionForUrl(policy: ResidencyPolicy, url: string): string | null {
  const u = url.trim();
  let best: { region: string; len: number } | null = null;
  for (const [region, rule] of Object.entries(policy.regions)) {
    for (const prefix of rule.backends) {
      if (u.startsWith(prefix) && (!best || prefix.length > best.len)) best = { region, len: prefix.length };
    }
  }
  return best?.region ?? null;
}

/** The allowed region codes as a set (the deployment's `allowed` list). */
export function policyAllowedRegions(policy: ResidencyPolicy): Set<string> {
  return new Set(policy.allowed);
}

/** Does `host` match a single egress pattern? `*.example.com` matches the apex and any subdomain. */
function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".example.com"
    return h === p.slice(2) || h.endsWith(suffix);
  }
  return h === p;
}

/**
 * Is egress to `host` permitted under the policy? Allowed iff the host matches an egress pattern of
 * an ALLOWED region, OR is the host of one of that region's own declared backends (a region may
 * always reach the broker it is pinned to, so operators needn't restate it). Fail-closed: a host
 * matching nothing is refused.
 */
export function policyEgressAllowed(policy: ResidencyPolicy, host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  for (const region of policy.allowed) {
    const rule = policy.regions[region];
    if (!rule) continue;
    if (rule.egress.some((pat) => hostMatchesPattern(h, pat))) return true;
    for (const backend of rule.backends) {
      const bh = hostOf(backend);
      if (bh && (bh === h || h === bh)) return true;
    }
  }
  return false;
}
