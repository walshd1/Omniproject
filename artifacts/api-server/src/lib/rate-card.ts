import crypto from "node:crypto";
import { deriveKey } from "./crypto-keys";

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
  // HKDF (v2) key derivation — matches the rest of the codebase (lib/crypto-keys `deriveKey`)
  // instead of a bare SHA-256(master). NOTE: this is a one-time RE-KEY. The identity/title hashes
  // are persisted map keys (lib/rate-card-store), so an existing sealed rate card no longer
  // resolves after this change and must be re-entered once. See docs/rate-card upgrade note.
  return deriveKey(master, "rate-card:v2");
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
 * Resolve a value under the shared project → programme → central precedence rule: a project
 * override wins, then a programme override, then the central default — so a person/setting can
 * carry a different value on a specific engagement without needing to override every level.
 * `projectMap`/`programmeMap` are keyed by scope id; `pick` extracts the effective value from a
 * scope-level container (undefined when that scope isn't set, or has no entry there — falls
 * through to the next level).
 */
export function resolveScoped<S, T>(
  scope: RateScope,
  projectMap: Record<string, S> | undefined,
  programmeMap: Record<string, S> | undefined,
  central: S,
  pick: (container: S | undefined) => T | undefined,
): T | undefined {
  const proj = scope.projectId ? projectMap?.[scope.projectId] : undefined;
  const prog = scope.programmeId ? programmeMap?.[scope.programmeId] : undefined;
  return pick(proj) ?? pick(prog) ?? pick(central);
}

/**
 * The job-title hash assigned to a person at a scope. Project override wins over programme, which wins
 * over the central default — so a person can carry a different grade on a specific engagement.
 */
export function resolveTitleHash(map: IdentityMap, assignee: string, scope: RateScope = {}): string | null {
  const h = hashIdentity(assignee);
  return resolveScoped(scope, map.project, map.programme, map.central, (container) => container?.[h]) ?? null;
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

/**
 * The customer-facing uplift on true cost: `overhead` (non-billable burden — facilities, admin) and
 * `margin` (profit), both as fractions (0.2 = 20%). Cost to customer = cost × (1 + overhead + margin).
 * These are set centrally and overridable at programme/project level (resolved by the store).
 */
export interface Uplift {
  margin: number;
  overhead: number;
}

export const emptyUplift = (): Uplift => ({ margin: 0, overhead: 0 });

/** The charge-out rate for a cost rate under an uplift — the second value per project type. */
export function chargeRate(cost: number, uplift: Uplift): number {
  return cost * (1 + Math.max(0, uplift.overhead) + Math.max(0, uplift.margin));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface StaffCostRow {
  titleHash: string;
  titleLabel: string;
  hours: number;
  /** True cost of this role's time. */
  cost: number;
  /** Billed to the customer (client-facing time only; 0 for internal-only roles). */
  charge: number;
}

export interface StaffCost {
  /** True cost of internal (non-billable) time. */
  internalCost: number;
  /** True cost of client-facing (billable) time. */
  clientCost: number;
  /** internalCost + clientCost — what the work actually costs us. */
  totalCost: number;
  /** Billed to the customer = client-facing cost uplifted by overhead + margin. Internal time isn't billed. */
  charge: number;
  /** charge − clientCost — the gross margin on client-facing time. */
  margin: number;
  /** Hours that couldn't be costed — no title mapping or no rate for the role/type/facing. */
  unratedHours: number;
  byTitle: StaffCostRow[];
}

/**
 * Roll up the two values of staff time: **true cost** (Σ loggedHours × cost rate, split client-facing vs
 * internal) and **cost to customer** (client-facing time uplifted by overhead + margin — internal time
 * is never billed). Returns both, plus the gross margin and a per-role breakdown. Items with no
 * assignee/hours contribute nothing; items whose role or rate can't be resolved add their hours to
 * `unratedHours` (visible, never silently zero-costed).
 */
export function staffCost(
  items: readonly TimedItem[],
  card: RateCard,
  map: IdentityMap,
  projectType: string,
  uplift: Uplift = emptyUplift(),
  scope: RateScope = {},
): StaffCost {
  let internalCost = 0;
  let clientCost = 0;
  let charge = 0;
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
    let rowCharge = 0;
    if (facing === "client") {
      clientCost += cost;
      rowCharge = hours * chargeRate(rate, uplift);
      charge += rowCharge;
    } else {
      internalCost += cost;
    }
    const row = byTitle.get(titleHash) ?? { titleHash, titleLabel: card.titles[titleHash] ?? "—", hours: 0, cost: 0, charge: 0 };
    row.hours += hours;
    row.cost += cost;
    row.charge += rowCharge;
    byTitle.set(titleHash, row);
  }

  return {
    internalCost,
    clientCost,
    totalCost: internalCost + clientCost,
    charge: round2(charge),
    margin: round2(charge - clientCost),
    unratedHours,
    byTitle: [...byTitle.values()].map((r) => ({ ...r, charge: round2(r.charge) })).sort((a, b) => b.cost - a.cost),
  };
}

/**
 * A PMO-defined value column on a project type — there can be **any number** of them, so a type carries
 * one value (small internal: just cost), two (cost + charge), or more (e.g. cost / standard charge /
 * intra-company charge). A `cost` column reports true cost; a `charge` column reports client-facing cost
 * uplifted by its own margin/overhead (or, per field, the scope-resolved uplift).
 */
export interface ValueColumn {
  id: string;
  label: string;
  kind: "cost" | "charge";
  /** A charge column's own uplift; when a field is absent it falls back to the scope-resolved uplift. */
  uplift?: Partial<Uplift>;
}

/** The value model a project type uses when it declares none — the two-value cost + charge. */
export const DEFAULT_VALUE_MODEL: ValueColumn[] = [
  { id: "cost", label: "Cost", kind: "cost" },
  { id: "charge", label: "Charge", kind: "charge" },
];

export interface ColumnTotal {
  id: string;
  label: string;
  kind: "cost" | "charge";
  total: number;
}

/**
 * Compute each declared value column's total from a staff-cost roll-up. A `cost` column is the true
 * total cost; a `charge` column is client-facing cost uplifted by its own margin/overhead (falling back
 * per field to the scope uplift), so a type can expose several charge tiers from the one roll-up.
 */
export function valueColumns(staff: StaffCost, columns: readonly ValueColumn[], scopeUplift: Uplift = emptyUplift()): ColumnTotal[] {
  return columns.map((c) => {
    if (c.kind === "cost") return { id: c.id, label: c.label, kind: c.kind, total: round2(staff.totalCost) };
    const overhead = c.uplift?.overhead ?? scopeUplift.overhead;
    const margin = c.uplift?.margin ?? scopeUplift.margin;
    return { id: c.id, label: c.label, kind: c.kind, total: round2(staff.clientCost * (1 + Math.max(0, overhead) + Math.max(0, margin))) };
  });
}
