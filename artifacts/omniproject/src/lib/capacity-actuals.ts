import type { ResourceCapacity } from "@workspace/api-client-react";

/**
 * Capacity actuals-vs-plan — compare each resource's logged-time ACTUALS against their PLAN (allocation).
 * The plan comes from the resource-capacity read (assignedHours / availableHours / allocationPercentage);
 * the actuals come from logged effort (issue.loggedHours), summed per resource. Pure, derive-only over the
 * read model: nothing is stored, no write paths. Surfaces over- and under-delivery so a resource manager
 * sees who is burning past their allocation and who is running under it.
 */

/** Delivery band relative to plan (assigned hours): the actuals-vs-plan analogue of utilizationState. */
export type DeliveryState = "OVER_DELIVERED" | "ON_TRACK" | "UNDER_DELIVERED" | "NO_PLAN";

/** Logged actuals for one resource, keyed the same way as ResourceCapacity (resourceId, else resourceName). */
export interface ResourceActual {
  resourceId?: string | null | undefined;
  resourceName?: string | null | undefined;
  loggedHours: number;
}

/** One resource's actuals joined to their plan, with over/under-delivery derived. */
export interface CapacityActualRow {
  resourceId: string;
  resourceName: string;
  role: string;
  /** Planned/allocated hours for the window (ResourceCapacity.assignedHours). */
  plannedHours: number;
  /** Available capacity in the window (ResourceCapacity.availableHours). */
  availableHours: number;
  /** Plan allocation as a percentage of availability (ResourceCapacity.allocationPercentage). */
  allocationPercentage: number;
  /** Logged actuals summed from issues assigned to this resource. */
  loggedHours: number;
  /** loggedHours − plannedHours: positive = over-delivered, negative = under-delivered. */
  varianceHours: number;
  /** loggedHours ÷ plannedHours × 100 (null when there is no plan to measure against). */
  deliveryPercentage: number | null;
  state: DeliveryState;
}

/** Portfolio-level roll-up of actuals vs plan across every resource row. */
export interface CapacityActualsSummary {
  rows: CapacityActualRow[];
  totalPlannedHours: number;
  totalLoggedHours: number;
  /** totalLoggedHours − totalPlannedHours across all resources. */
  totalVarianceHours: number;
  /** totalLoggedHours ÷ totalPlannedHours × 100 (null when nothing is planned). */
  overallDeliveryPercentage: number | null;
  overDelivered: number;
  underDelivered: number;
  onTrack: number;
  /** Resources with actuals but no matching plan row (loggedHours with NO_PLAN). */
  noPlan: number;
}

/** Percent within this band of plan counts as ON_TRACK (both directions). */
const ON_TRACK_BAND = 10;

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (n: number | null | undefined): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** The join key for a capacity/actual row: prefer the stable id, fall back to the display name. */
function keyOf(row: { resourceId?: string | null | undefined; resourceName?: string | null | undefined }): string | null {
  return row.resourceId ?? row.resourceName ?? null;
}

/** Classify delivery against plan: NO_PLAN when nothing is allocated, else banded around the plan. */
function deliveryState(plannedHours: number, loggedHours: number): DeliveryState {
  if (plannedHours <= 0) return "NO_PLAN";
  const pct = (loggedHours / plannedHours) * 100;
  if (pct > 100 + ON_TRACK_BAND) return "OVER_DELIVERED";
  if (pct < 100 - ON_TRACK_BAND) return "UNDER_DELIVERED";
  return "ON_TRACK";
}

/** Sum logged actuals per resource key, so an actuals source can be a flat list of issue rows. */
export function sumActualsByResource(
  actuals: ResourceActual[],
): Map<string, { loggedHours: number; resourceName: string | null }> {
  const byKey = new Map<string, { loggedHours: number; resourceName: string | null }>();
  for (const a of actuals) {
    const key = keyOf(a);
    if (key === null) continue;
    const logged = num(a.loggedHours);
    if (logged === 0) continue;
    const prev = byKey.get(key);
    byKey.set(key, {
      loggedHours: num(prev?.loggedHours) + logged,
      resourceName: prev?.resourceName ?? a.resourceName ?? null,
    });
  }
  return byKey;
}

/**
 * Join plan rows (ResourceCapacity) to logged actuals and derive over/under-delivery per resource.
 * Resources appear plan-first (in the order given), then any actuals with no matching plan (NO_PLAN),
 * with the whole set sorted most-over-delivered first so contention surfaces at the top.
 */
export function deriveCapacityActuals(
  plan: ResourceCapacity[],
  actuals: ResourceActual[],
): CapacityActualsSummary {
  const logged = sumActualsByResource(actuals);
  const seen = new Set<string>();
  const rows: CapacityActualRow[] = [];

  for (const p of plan) {
    const key = keyOf(p);
    const loggedHours = key !== null ? num(logged.get(key)?.loggedHours) : 0;
    if (key !== null) seen.add(key);
    const plannedHours = num(p.assignedHours);
    rows.push({
      resourceId: p.resourceId ?? key ?? "",
      resourceName: p.resourceName ?? "",
      role: p.role ?? "",
      plannedHours,
      availableHours: num(p.availableHours),
      allocationPercentage: num(p.allocationPercentage),
      loggedHours,
      varianceHours: round1(loggedHours - plannedHours),
      deliveryPercentage: plannedHours > 0 ? round1((loggedHours / plannedHours) * 100) : null,
      state: deliveryState(plannedHours, loggedHours),
    });
  }

  // Actuals with no plan row — logged work against an unplanned/unmatched resource.
  for (const [key, v] of logged) {
    if (seen.has(key)) continue;
    rows.push({
      resourceId: key,
      resourceName: v.resourceName ?? key,
      role: "",
      plannedHours: 0,
      availableHours: 0,
      allocationPercentage: 0,
      loggedHours: round1(v.loggedHours),
      varianceHours: round1(v.loggedHours),
      deliveryPercentage: null,
      state: "NO_PLAN",
    });
  }

  rows.sort((a, b) => b.varianceHours - a.varianceHours);

  let totalPlannedHours = 0;
  let totalLoggedHours = 0;
  let overDelivered = 0;
  let underDelivered = 0;
  let onTrack = 0;
  let noPlan = 0;
  for (const r of rows) {
    totalPlannedHours += r.plannedHours;
    totalLoggedHours += r.loggedHours;
    if (r.state === "OVER_DELIVERED") overDelivered += 1;
    else if (r.state === "UNDER_DELIVERED") underDelivered += 1;
    else if (r.state === "ON_TRACK") onTrack += 1;
    else noPlan += 1;
  }

  return {
    rows,
    totalPlannedHours: round1(totalPlannedHours),
    totalLoggedHours: round1(totalLoggedHours),
    totalVarianceHours: round1(totalLoggedHours - totalPlannedHours),
    overallDeliveryPercentage: totalPlannedHours > 0 ? round1((totalLoggedHours / totalPlannedHours) * 100) : null,
    overDelivered,
    underDelivered,
    onTrack,
    noPlan,
  };
}

/** A one-line headline summarising the actuals-vs-plan posture across all resources. */
export function capacityActualsHeadline(s: CapacityActualsSummary): string {
  if (s.rows.length === 0) return "No capacity data to compare.";
  const delivery = s.overallDeliveryPercentage === null ? "—" : `${s.overallDeliveryPercentage}%`;
  const sign = s.totalVarianceHours > 0 ? "+" : "";
  return `${s.totalLoggedHours}h logged vs ${s.totalPlannedHours}h planned (${delivery}, ${sign}${s.totalVarianceHours}h); ${s.overDelivered} over-, ${s.underDelivered} under-delivered.`;
}
