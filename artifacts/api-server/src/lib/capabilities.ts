import type { Request } from "express";
import { getBroker, contextFromReq } from "../broker";
import type { BackendFieldMap, FieldSupport } from "../broker/types";
import { brokerSupportUnion, unionSupport, BROKER_CAPABILITY_KEYS } from "@workspace/backend-catalogue";
import { connectedBrokers } from "../broker/registry";
import { parseCommaSet } from "./env";
import {
  FIELD_REGISTRY,
  customFieldsFrom,
  reconcileFields,
  inferRelationshipCandidates,
  type FieldReconciliation,
  type RelationshipEdge,
  type FieldGroup,
  type EnumeratedField,
} from "./field-registry";
import { getSettings } from "./settings";
import { isTimeTravelEnabled } from "./logging-sync";
import { dataResidencyEnabled, allowedRegions } from "./data-residency";
import { artifactStoreEnabled } from "./artifact-store";
import { buildLiveSuperset, sidecarSupersetInput, type SupersetField, type SupersetInput } from "./superset";
import { listDefs } from "./def-import";
import { validateCustomFieldDef, customFieldToEnumerated, type CustomFieldDef } from "./custom-fields";

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
  // Superset domains — gate the CRM/service/quality field groups. Off unless a
  // backend declares them (a pure issue tracker shows none of these).
  "quality",
  "crm",
  "service",
  // Benefits realisation — gates the benefits field group (planned vs actual value,
  // owner, measure, status). Off unless a backend declares it.
  "benefits",
  // Stakeholder engagement — gates the stakeholder field group + entity (role,
  // influence/interest, engagement, comms cadence). Off unless a backend declares it.
  "stakeholders",
  // RACI assignment — gates the raci field group + entity (deliverable → R/A/C/I).
  // Off unless a backend declares it.
  "raci",
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
export const ENTITY_KEYS = [
  "project", "programme", "raid", "issue", "note", "member", "customField",
  // CRM/service entities — gated by the crm/service domains.
  "account", "contact", "deal", "pipeline", "service",
  // Governance entities — stakeholder register + RACI matrix, each gated by its domain.
  "stakeholder", "raci",
  // Task — GTD actionable next-actions (broker-gated by listTasks); carries the task field group.
  "task",
] as const;

export interface Capabilities extends Record<CapabilityDomain, boolean> {
  mode: string;
  /** Historical time-travel — true only when the operator opted into egress. */
  timeTravel: boolean;
  /** Per-field surface/store support. */
  fields: Record<string, FieldSupport>;
  /** Per-entity surface/store support. */
  entities: Record<string, FieldSupport>;
  /**
   * NON-canonical fields the backend's describe surfaced (the reconcile path):
   * tenant/custom fields the registry doesn't model, carried through as gated
   * passthrough so they light up without a registry edit. Empty/absent ⇒ none
   * discovered (or the broker doesn't enumerate fields).
   */
  customFields?: EnumeratedField[];
  /**
   * Per-field lineage: which backend system + native field each canonical/custom
   * field is read from (e.g. dueDate → { system: "jira", field: "duedate" }).
   * Populated from the broker's describe; absent when the broker doesn't say.
   * Lets the UI show "this value came from that backend field".
   */
  fieldSources?: Record<string, { system: string; field: string }>;
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
/** Which capability domain gates each field group. */
const GROUP_DOMAIN: Record<FieldGroup, CapabilityDomain> = {
  core: "issues",
  people: "issues",
  classification: "issues",
  agile: "issues",
  relationship: "issues",
  derived: "issues",
  schedule: "scheduling",
  effort: "resources",
  financial: "financials",
  quality: "quality",
  crm: "crm",
  service: "service",
  // Strategic alignment (goals/KPIs/OKRs) is portfolio-tier — it lights up at the
  // project + programme level when the backend supports the portfolio domain.
  strategy: "portfolio",
  // Benefits realisation has its own domain — a backend can track benefits without
  // a full portfolio rollup.
  benefits: "benefits",
  // Stakeholder engagement + RACI each ride their own domain, so governance data
  // lights up only when a backend actually carries it.
  stakeholder: "stakeholders",
  raci: "raci",
  // Risk register extends RAID — its quantitative fields ride the existing raid domain
  // rather than a duplicate one.
  risk: "raid",
  // GTD task fields (context, waiting-on, reminder, energy, section, …) are work-item
  // data — they ride the issues domain, so a backend that can carry work items lights
  // them up (task apps all declare issues). Task presence itself is broker-gated (listTasks).
  task: "issues",
};

/** Build the per-domain field manifest a backend exposes from its enabled capability domains. */
export function deriveFieldMap(enabled: Partial<Record<CapabilityDomain, boolean>>): BackendFieldMap {
  const issues = !!enabled.issues;
  const portfolio = !!enabled.portfolio;
  const raid = !!enabled.raid;
  const crm = !!enabled.crm;
  const service = !!enabled.service;
  const stakeholders = !!enabled.stakeholders;
  const raci = !!enabled.raci;
  const fields: Record<string, FieldSupport> = {};
  for (const f of FIELD_REGISTRY) {
    // programme membership is gated by the portfolio domain, not issues.
    const domain = f.references === "programme" ? "portfolio" : GROUP_DOMAIN[f.group ?? "core"];
    const on = !!enabled[domain];
    // Derived/rolled-up values are read-only (surface without store).
    fields[f.key] = sup(on, f.group === "derived" ? false : on);
  }
  return {
    fields,
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
      // Generic passthrough for backend fields that aren't canonical — opt-in.
      customField: sup(false),
      // CRM entities — surfaced only when the backend declares the crm domain.
      account: sup(crm),
      contact: sup(crm),
      deal: sup(crm),
      pipeline: sup(crm, false), // pipelines are read-through (backend-owned)
      // Service entity (CMDB CI / affected service) — gated by the service domain.
      service: sup(service, false),
      // Governance entities — the stakeholder register + RACI matrix, each gated by
      // its own domain (a backend can carry one without the other).
      stakeholder: sup(stakeholders),
      raci: sup(raci),
      // Task entity — actionable next-actions ride the issues domain (task apps declare it);
      // whether a backend can actually store tasks is broker-gated (listTasks/createTask).
      task: sup(issues),
    },
  };
}

/**
 * Lay the admin translation-layer overrides on top of a resolved map. Each
 * override REPLACES that key's surface/store — the deliberate way an admin
 * corrects a mis-mapped field/entity. Returns a new map (no mutation).
 */
function applyOverrides(map: BackendFieldMap): BackendFieldMap {
  const ov = getSettings().fieldOverrides;
  if (!ov || (!Object.keys(ov.fields ?? {}).length && !Object.keys(ov.entities ?? {}).length)) return map;
  return {
    fields: { ...map.fields, ...ov.fields },
    entities: { ...map.entities, ...ov.entities },
  };
}

function build(
  mode: string,
  enabled: Partial<Record<CapabilityDomain, boolean>>,
  baseMap: BackendFieldMap = deriveFieldMap(enabled),
): Capabilities {
  const map = applyOverrides(baseMap);
  const caps = {
    mode,
    timeTravel: isTimeTravelEnabled(),
    // Non-sensitive residency posture (enabled + allowed region CODES, never URLs/secrets) — open to
    // any authenticated user via /api/capabilities, unlike the admin-only /api/security/data-residency
    // status. Lets the cross-programme resource-levelling view gate a modelled move through the SAME
    // fail-closed policy the broker/egress hop already enforces, instead of inventing a new one.
    residency: { enabled: dataResidencyEnabled(), allowedRegions: [...allowedRegions()] },
    fields: map.fields,
    entities: map.entities,
  } as unknown as Capabilities;
  for (const d of CAPABILITY_DOMAINS) caps[d] = !!enabled[d];
  return caps;
}

function fromEnv(): Capabilities | null {
  const raw = process.env["CAPABILITIES"]?.trim();
  if (!raw) return null;
  const set = parseCommaSet(raw);
  const enabled = Object.fromEntries(CAPABILITY_DOMAINS.map((d) => [d, set.has(d)])) as Record<CapabilityDomain, boolean>;
  return build("env", enabled);
}

/** Await an optional-method call, swallowing a rejection to `fallback` (never throws).
 *  `result` is the already-invoked `broker.x?.(ctx)` — `undefined` when the broker doesn't
 *  implement the method at all, in which case there's nothing to await. */
async function probe<T>(result: Promise<T> | undefined, fallback: T): Promise<T> {
  if (!result) return fallback;
  return result.catch(() => fallback);
}

/**
 * The describe → reconcile path: ask the backend what fields it actually exposes and
 * auto-surface any NON-canonical ones as gated custom fields (so tenant/custom fields light
 * up without a registry edit), plus per-field lineage (which backend system/field each came
 * from). Mutates and returns `caps` in place — best-effort, a broker that doesn't enumerate
 * fields simply contributes nothing here.
 */
function enrichWithCustomFieldsAndLineage(caps: Capabilities, enumerated: EnumeratedField[] | null, brokerKind: string): Capabilities {
  if (!enumerated || !enumerated.length) return caps;
  const customs = customFieldsFrom(enumerated);
  if (customs.length) {
    caps.customFields = customs;
    // Discovering customs flips the passthrough entity on (surface). Storing
    // them stays whatever the map already said — read-through unless declared.
    const existing = caps.entities["customField"];
    caps.entities = { ...caps.entities, customField: { surface: true, store: existing?.store ?? false } };
  }
  // Per-field lineage: capture the backend system + native field for any
  // enumerated field that declares one, so the UI can show where data came from.
  const sources: Record<string, { system: string; field: string }> = {};
  for (const f of enumerated) {
    if (f.sourceField) sources[f.key] = { system: f.sourceSystem ?? brokerKind, field: f.sourceField };
  }
  if (Object.keys(sources).length) caps.fieldSources = sources;
  return caps;
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
  // The three probes are independent reads — issue them concurrently rather than in series (build
  // needs flags+map, enrich needs enumerated, but none of the FETCHES depend on another's result).
  const [flags, map, enumerated] = await Promise.all([
    probe(broker.capabilities(ctx), null),
    probe(broker.fieldMap?.(ctx), undefined), // prefer the broker's explicit field/entity map; else domain-derived
    probe(broker.describeFields?.(ctx), null),
  ]);
  const enabled = Object.fromEntries(
    CAPABILITY_DOMAINS.map((d) => [d, !!flags?.[d]]),
  ) as Record<CapabilityDomain, boolean>;
  const caps = build(broker.kind, enabled, map ?? undefined);
  return enrichWithCustomFieldsAndLineage(caps, enumerated, broker.kind);
}

/**
 * The BROKER half of the support set: the capability keys the connected broker(s)
 * contribute, OR-unioned across however many KINDS are connected (the multi-broker
 * registry — `BROKER_KINDS` ∪ the active broker). A demo/in-process broker
 * simulates the full reference broker, so it enables every broker capability —
 * mirroring how demo enables every backend domain. Live brokers contribute exactly
 * what their catalogue definitions declare.
 */
function resolveBrokerSupport(): Record<string, boolean> {
  const connected = connectedBrokers();
  if (connected.some((b) => !b.live)) return Object.fromEntries(BROKER_CAPABILITY_KEYS.map((k) => [k, true]));
  return brokerSupportUnion(connected.map((b) => b.kind));
}

/**
 * The unified SUPPORT set the compatibility predicate gates on: the backend
 * capability domains (already unioned across connected backends by
 * `resolveCapabilities`) PLUS the connected broker(s)' capability keys — one flat
 * map spanning BOTH planes. This is the resolver `availableReports` /
 * `availableScreens` / the views filter should be fed, so an asset can require a
 * broker capability (e.g. `eventsOutbound`) and light up only when a broker
 * supports it, not just a backend domain.
 */
export async function resolveSupport(req: Request): Promise<Record<string, boolean>> {
  const caps = await resolveCapabilities(req);
  return unionSupport(caps as unknown as Record<string, unknown>, resolveBrokerSupport());
}

/**
 * The per-backend field manifest — the reconcile path made inspectable. Diffs the
 * backend's describe against the canonical registry (known / unknown / missing)
 * and flags relationship candidates among the unknowns. Powers the admin
 * translation layer's "what does this backend expose, what's unmapped" view.
 */
export interface FieldManifest {
  mode: string;
  enumerated: EnumeratedField[];
  reconciliation: FieldReconciliation;
  customFields: EnumeratedField[];
  relationshipCandidates: RelationshipEdge[];
}

/** Resolve the field manifest: reconcile the backend's enumerated fields against the canonical registry (known vs new/custom). */
export async function resolveFieldManifest(req: Request): Promise<FieldManifest> {
  const broker = getBroker();
  const ctx = contextFromReq(req);
  const enumerated = await probe(broker.describeFields?.(ctx), []);
  return {
    mode: broker.kind,
    enumerated,
    reconciliation: reconcileFields(enumerated),
    customFields: customFieldsFrom(enumerated),
    relationshipCandidates: inferRelationshipCandidates(enumerated, ENTITY_KEYS),
  };
}

/**
 * The LIVE SUPERSET (roadmap §4.6): every field mappable RIGHT NOW — the union of the connected backend(s)'
 * advertised fields PLUS the sidecar's full canonical vocabulary when the sidecar is on. Only live+linked fields
 * appear (it's built from what's actually connected), duplicates are kept distinct per backend, and it
 * grows/shrinks with the connected set. This is what the mapping picker binds to, so an admin can only map a UI
 * element onto a field that a real, active backend can serve.
 *
 * Honest scope: `describeFields` runs against the ACTIVE broker (one concrete adapter today), so the non-sidecar
 * half is the active backend's fields; per-kind adapters for other connected brokers are the remaining last mile
 * (see broker/registry.ts). The sidecar half is fully live now.
 */
export async function resolveLiveSuperset(req: Request, opts: { programmeId?: string } = {}): Promise<SupersetField[]> {
  const broker = getBroker();
  const ctx = contextFromReq(req);
  const enumerated = await probe(broker.describeFields?.(ctx), []);
  const inputs: SupersetInput[] = [];
  if (enumerated.length) inputs.push({ broker: broker.kind, system: broker.kind, fields: enumerated });
  if (artifactStoreEnabled()) inputs.push(sidecarSupersetInput()); // the sidecar advertises the canonical types it can HOLD (a home)

  // The superset is a UNION: backend-advertised fields ∪ org/programme custom fields authored via the importer.
  // A custom field's DEFINITION is the superset (org/programme JSON); its DATA lives at its home (default: the
  // sidecar via the built-in broker). Read org always; the caller's programme when named + in scope.
  const cf: CustomFieldDef[] = [];
  if (artifactStoreEnabled()) {
    for (const d of listDefs({ kind: "org" })) if (d.kind === "customField") { try { cf.push(validateCustomFieldDef(d.payload)); } catch { /* skip a corrupt row */ } }
    if (opts.programmeId) for (const d of listDefs({ kind: "programme", programmeId: opts.programmeId })) if (d.kind === "customField") { try { cf.push(validateCustomFieldDef(d.payload)); } catch { /* skip */ } }
  }
  // Legacy settings.customFields bridge (sidecar-homed) — folded in until it's drained to the importer.
  for (const legacy of getSettings().customFields ?? []) cf.push({ key: legacy.key, label: legacy.label, type: legacy.type });

  const byHome = new Map<string, SupersetInput>();
  for (const c of cf) {
    const { broker: b, system, field } = customFieldToEnumerated(c);
    const k = `${b} ${system}`;
    if (!byHome.has(k)) byHome.set(k, { broker: b, system, fields: [] });
    byHome.get(k)!.fields.push(field);
  }
  inputs.push(...byHome.values());

  return buildLiveSuperset(inputs);
}
