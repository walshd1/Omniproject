import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";
import type { BackendFieldMap, FieldSupport } from "../broker/types";
import { FIELD_REGISTRY } from "./field-registry";
import { isTimeTravelEnabled } from "./settings";

/**
 * Capability signal — which data domains the wired backend(s) can populate, so
 * the UI can pre-emptively label available reports/views instead of probing per
 * request. Resolution order:
 *   1. CAPABILITIES env (gateway-declared, authoritative) — comma list of
 *      enabled domains, e.g. "issues,scheduling,portfolio".
 *   2. The active broker's capability report (live adapter probes its backend
 *      with conservative defaults on error).
 *   3. Demo defaults — everything (sample data covers all reports).
 */

export const CAPABILITY_DOMAINS = [
  "issues",
  "scheduling",
  "resources",
  "financials",
  "portfolio",
  "baseline",
  "blockers",
  "history",
  "raid",
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

/**
 * Canonical work-item fields the UI can gate on — derived from the single source
 * of truth (the field registry) so the two can never drift. New backends extend
 * the vocabulary by editing the registry (see lib/field-registry.ts).
 */
export const FIELD_KEYS: readonly string[] = FIELD_REGISTRY.map((f) => f.key);

/**
 * Canonical higher-level entities the UI can gate on. `issue` and `note` are the
 * 0..many children a task can carry *if the backend can store them* — distinct
 * from the work-item itself (which the UI labels "Task").
 */
export const ENTITY_KEYS = ["project", "programme", "raid", "issue", "note", "member"] as const;

export interface Capabilities extends Record<CapabilityDomain, boolean> {
  mode: string;
  /** Historical time-travel — true only when the operator opted into egress. */
  timeTravel: boolean;
  /** Per-field surface/store support. */
  fields: Record<string, FieldSupport>;
  /** Per-entity surface/store support. */
  entities: Record<string, FieldSupport>;
}

const sup = (surface: boolean, store = surface): FieldSupport => ({ surface, store });

/**
 * Derive a per-field/entity map from the coarse domain flags — the fallback used
 * when the broker doesn't declare an explicit map. It's deliberately
 * conservative: computed/rolled-up values (completionPct) are read-only, and
 * `project` is read-through (no create) by default. A backend that supports more
 * (or less — e.g. a tracker without story points) overrides this via
 * `Broker.fieldMap`.
 */
export function deriveFieldMap(enabled: Partial<Record<CapabilityDomain, boolean>>): BackendFieldMap {
  const issues = !!enabled.issues;
  const sched = !!enabled.scheduling;
  const portfolio = !!enabled.portfolio;
  const raid = !!enabled.raid;
  return {
    fields: {
      title: sup(issues),
      status: sup(issues),
      priority: sup(issues),
      assignee: sup(issues),
      description: sup(issues),
      labels: sup(issues),
      startDate: sup(sched),
      dueDate: sup(sched),
      storyPoints: sup(issues),
      completionPct: sup(issues, false), // derived/rolled-up → read-only
      programmeId: sup(portfolio),
    },
    entities: {
      project: sup(issues, false), // read-through by default; creation is opt-in
      programme: sup(portfolio),
      raid: sup(raid),
      // Task children — opt-in: a backend must explicitly declare it can store
      // issues/notes against a task (via Broker.fieldMap), else they're hidden.
      issue: sup(false),
      note: sup(false),
      // Project members (with access level) — opt-in; drives the assignee picker.
      member: sup(false),
    },
  };
}

function build(
  mode: string,
  enabled: Partial<Record<CapabilityDomain, boolean>>,
  map: BackendFieldMap = deriveFieldMap(enabled),
): Capabilities {
  const caps = {
    mode,
    timeTravel: isTimeTravelEnabled(),
    fields: map.fields,
    entities: map.entities,
  } as Capabilities;
  for (const d of CAPABILITY_DOMAINS) caps[d] = !!enabled[d];
  return caps;
}

function fromEnv(): Capabilities | null {
  const raw = process.env["CAPABILITIES"]?.trim();
  if (!raw) return null;
  const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  const enabled = Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, set.has(d)])) as Record<CapabilityDomain, boolean>;
  return build("env", enabled);
}

/**
 * Resolve which data domains the active backend can populate. Order:
 *   1. CAPABILITIES env (gateway-declared, authoritative).
 *   2. The broker's own capability report — the demo adapter enables everything;
 *      a live adapter probes its backend (with conservative defaults + caching).
 * The `mode` mirrors the active broker.
 */
export async function resolveCapabilities(req: Request): Promise<Capabilities> {
  const env = fromEnv();
  if (env) return env;

  const broker = getBroker();
  const ctx = contextFromReq(req);
  const flags = await broker.capabilities(ctx).catch(() => null);
  const enabled = Object.fromEntries(
    CAPABILITY_DOMAINS.map((d) => [d, !!flags?.[d]]),
  ) as Record<CapabilityDomain, boolean>;
  // Prefer the broker's explicit field/entity map; fall back to domain-derived.
  const map = (await broker.fieldMap?.(ctx).catch(() => null)) ?? undefined;
  return build(broker.kind, enabled, map ?? undefined);
}
