import crypto from "node:crypto";

/**
 * Rate-card domain — the pure core of staff time-and-cost.
 *
 * The sensitivity rule: a person's identity and their pay grade never sit together in clear. The
 * registry keys everything by a **keyed hash** of the raw value (`hashIdentity`), so the stored map is
 * `hash(assignee) → hash(jobTitle)` and the rate card is `hash(jobTitle) → rates`. The hash is an HMAC
 * under a per-deployment key, so it's stable for matching but not reversible by a name/title dictionary.
 * The human-readable label for a title is held alongside its hash and is encrypted at rest by the store
 * (this module never persists anything — it's pure).
 *
 * Rate resolution has three independent dimensions:
 *   - **role** (the job-title hash),
 *   - **project type** (a PMO-defined category chosen per project; `"*"` is the default/any),
 *   - **facing** — `client` (billable, client-facing time) vs `internal` (overhead) — which can carry
 *     different rates for the same role.
 *
 * Identity → title resolves with monotonic scope override (project beats programme beats central), the
 * same precedence as the feature-gating hierarchy.
 */

export type Facing = "client" | "internal";

/** A stable, non-reversible keyed hash of a raw identity/title value. */
export function hashIdentity(raw: string): string {
  return crypto.createHmac("sha256", hashKey()).update(`rate-id:${raw.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

function hashKey(): Buffer {
  const master =
    process.env["RATE_CARD_KEY"]?.trim() ||
    process.env["SESSION_SECRET"]?.trim() ||
    process.env["BROKER_PSK"]?.trim() ||
    "omni-rate-card-dev-key-not-for-production";
  return crypto.createHash("sha256").update(`rate-card:v1:${master}`).digest();
}

/** Rates for one role: projectType → facing → hourly rate. `"*"` is the default project type. */
export type RoleRates = Record<string, Partial<Record<Facing, number>>>;

export interface RateCard {
  /** titleHash → human label (the only place the title text lives; encrypted at rest by the store). */
  titles: Record<string, string>;
  /** titleHash → its rates. */
  rates: Record<string, RoleRates>;
}

export interface IdentityMap {
  /** Org-wide default assignment: hash(assignee) → hash(jobTitle). */
  central: Record<string, string>;
  /** Per-programme overrides. */
  programme: Record<string, Record<string, string>>;
  /** Per-project overrides. */
  project: Record<string, Record<string, string>>;
}

export interface RateScope {
  programmeId?: string | null;
  projectId?: string | null;
}

export const emptyRateCard = (): RateCard => ({ titles: {}, rates: {} });
export const emptyIdentityMap = (): IdentityMap => ({ central: {}, programme: {}, project: {} });

/**
 * The job-title hash assigned to a person at a scope. Project override wins over programme, which wins
 * over the central default — so a person can carry a different grade on a specific engagement.
 */
export function resolveTitleHash(map: IdentityMap, assignee: string, scope: RateScope = {}): string | null {
  const h = hashIdentity(assignee);
  if (scope.projectId && map.project[scope.projectId]?.[h]) return map.project[scope.projectId]![h]!;
  if (scope.programmeId && map.programme[scope.programmeId]?.[h]) return map.programme[scope.programmeId]![h]!;
  return map.central[h] ?? null;
}

/**
 * The hourly rate for a role on a project type and facing. Falls back from the specific project type to
 * the default (`"*"`); never crosses facing (client and internal are deliberately distinct). Returns
 * null when no rate is set, so the caller can surface "unrated" rather than silently costing at zero.
 */
export function resolveRate(card: RateCard, titleHash: string | null, projectType: string, facing: Facing): number | null {
  if (!titleHash) return null;
  const roleRates = card.rates[titleHash];
  if (!roleRates) return null;
  const exact = roleRates[projectType]?.[facing];
  if (typeof exact === "number") return exact;
  const fallback = roleRates["*"]?.[facing];
  return typeof fallback === "number" ? fallback : null;
}

/** One time-logged work item: who, how long, and whether the time is client-facing (billable). */
export interface TimedItem {
  assignee?: string | null;
  loggedHours?: number | null;
  /** Billable time is treated as client-facing; everything else is internal. */
  billable?: boolean | null;
}

export interface StaffCostRow {
  titleHash: string;
  titleLabel: string;
  hours: number;
  cost: number;
}

export interface StaffCost {
  internal: number;
  client: number;
  total: number;
  /** Hours that couldn't be costed — no title mapping or no rate for the role/type/facing. */
  unratedHours: number;
  byTitle: StaffCostRow[];
}

/**
 * Roll up staff cost = Σ (loggedHours × resolved rate), split into client-facing vs internal and broken
 * down by role. Items with no assignee/hours contribute nothing; items whose role or rate can't be
 * resolved add their hours to `unratedHours` (visible, never silently zero-costed).
 */
export function staffCost(
  items: readonly TimedItem[],
  card: RateCard,
  map: IdentityMap,
  projectType: string,
  scope: RateScope = {},
): StaffCost {
  let internal = 0;
  let client = 0;
  let unratedHours = 0;
  const byTitle = new Map<string, StaffCostRow>();

  for (const it of items) {
    const hours = typeof it.loggedHours === "number" && it.loggedHours > 0 ? it.loggedHours : 0;
    if (!it.assignee || hours === 0) continue;
    const facing: Facing = it.billable ? "client" : "internal";
    const titleHash = resolveTitleHash(map, it.assignee, scope);
    const rate = resolveRate(card, titleHash, projectType, facing);
    if (titleHash === null || rate === null) {
      unratedHours += hours;
      continue;
    }
    const cost = hours * rate;
    if (facing === "client") client += cost;
    else internal += cost;
    const row = byTitle.get(titleHash) ?? { titleHash, titleLabel: card.titles[titleHash] ?? "—", hours: 0, cost: 0 };
    row.hours += hours;
    row.cost += cost;
    byTitle.set(titleHash, row);
  }

  return {
    internal,
    client,
    total: internal + client,
    unratedHours,
    byTitle: [...byTitle.values()].sort((a, b) => b.cost - a.cost),
  };
}
