/**
 * Self-host DB *domains* — the unit an operator adopts when they let OmniProject's own database
 * become a system-of-record (or an augmenting store) for a slice of the work-item superset.
 *
 * A domain is a NAMED, GATED bundle of canonical fields drawn from `FIELD_REGISTRY` (the same
 * superset every backend maps onto — see lib/backend-catalogue/field-vocabulary). Grouping the
 * superset into a handful of adoptable domains is what lets the wizard/admin say "hold your
 * financials in your database" without listing 200 columns: each domain is one toggle, scoped
 * org → programme → project through the existing feature-resolution model.
 *
 * The domains are DERIVED from the registry, not hand-listed: each domain names the canonical field
 * KEYS it owns, and we resolve them against `FIELD_REGISTRY` at module load (dropping any key the
 * registry doesn't know, so the set stays honest as the superset evolves). Nothing here holds data —
 * a domain is a manifest of which fields a self-host store may surface/store, nothing more.
 */
import { FIELD_REGISTRY, CANONICAL_FIELD_KEYS, type FieldDescriptor } from "@workspace/backend-catalogue";
import type { GateReason } from "../lib/feature-resolution";

/** A self-host domain id — the `<domain>` in the governed `selfhost:<domain>` catalogue id. */
export type SelfHostDomainId =
  | "issues"
  | "resources"
  | "financials"
  | "baseline"
  | "history"
  | "quality"
  | "raid"
  | "benefits"
  | "strategy";

/** The authored shape: a domain names the canonical field keys it owns + how it's gated. */
interface DomainSpec {
  id: SelfHostDomainId;
  label: string;
  /** Canonical field keys this domain owns (resolved against FIELD_REGISTRY at load). */
  fieldKeys: readonly string[];
  /** Core domains are always adoptable (no opt-in) — the irreducible work-item spine. */
  core?: boolean;
  /** Non-core domains are OFF until an org opts in — a deliberate storage/cost call. */
  gate?: GateReason;
  /** One honest line the wizard/admin shows: what adopting this domain unlocks. */
  unlocks: string;
}

/**
 * The nine adoptable domains. Every field key below is a real member of `FIELD_REGISTRY`; the
 * partition is disjoint (no field is owned by two domains) so a self-host store never claims a
 * field another self-host domain already owns.
 */
const DOMAIN_SPECS: readonly DomainSpec[] = [
  {
    id: "issues",
    label: "Work items",
    core: true,
    fieldKeys: [
      "title", "status", "description", "assignee", "reporter", "watchers",
      "priority", "labels", "type", "component", "resolution", "severity",
      "startDate", "dueDate", "milestone",
      "programmeId", "parentTask", "dependsOn", "blocks", "relatesTo", "duplicateOf",
    ],
    unlocks: "The work-item spine — items, status, people, scheduling and links held in your database.",
  },
  {
    id: "resources",
    label: "Resources & effort",
    gate: "cost",
    fieldKeys: [
      "estimateHours", "loggedHours", "remainingHours", "originalEstimateHours", "percentWorkComplete",
      "storyPoints", "sprint", "epic", "rank",
    ],
    unlocks: "Effort, estimates and agile sizing — capacity and burn tracked in your database.",
  },
  {
    id: "financials",
    label: "Financials",
    gate: "storage",
    fieldKeys: [
      "budget", "plannedCost", "actualCost", "currency", "billable", "costCenter",
      "plannedValue", "earnedValue", "budgetAtCompletion", "estimateAtCompletion", "estimateToComplete",
      "costVariance", "scheduleVariance", "costPerformanceIndex", "schedulePerformanceIndex",
      "billRate", "costRate", "committedCost", "purchaseOrder", "revenue", "invoicedAmount", "margin",
      "capitalised", "wbsCode", "expenditureType", "capexAmount", "opexAmount", "costCategory", "depreciationMonths",
    ],
    unlocks: "Budgets, actuals and EVM — earned-value and cost data held authoritatively in your database.",
  },
  {
    id: "baseline",
    label: "Baseline & critical path",
    gate: "storage",
    fieldKeys: ["baselineStart", "baselineFinish", "totalFloat", "criticalPath", "constraintType"],
    unlocks: "Schedule baselines and critical-path data — the plan-of-record kept in your database.",
  },
  {
    id: "history",
    label: "Actuals & history",
    gate: "storage",
    fieldKeys: ["actualStart", "actualFinish", "reopenCount"],
    unlocks: "What actually happened — actual dates and history retained in your database for time-travel.",
  },
  {
    id: "quality",
    label: "Health & quality",
    gate: "storage",
    fieldKeys: ["healthStatus", "riskLevel", "impact", "urgency", "blocked", "blockedReason", "mitigation", "defectCount"],
    unlocks: "RAG health, blockers and defect data held in your database.",
  },
  {
    id: "raid",
    label: "Risk register (RAID)",
    gate: "storage",
    fieldKeys: ["probability", "riskExposure", "responseStrategy"],
    unlocks: "The risk register — probability, exposure and response strategy in your database.",
  },
  {
    id: "benefits",
    label: "Benefits realisation",
    gate: "storage",
    fieldKeys: [
      "benefitType", "benefitOwner", "plannedBenefitValue", "actualBenefitValue", "benefitMeasure",
      "benefitBaseline", "benefitTarget", "benefitStartDate", "benefitDueDate", "benefitStatus", "benefitConfidence",
    ],
    unlocks: "Planned-vs-actual benefit value, measures and owners held in your database.",
  },
  {
    id: "strategy",
    label: "Strategic alignment",
    gate: "storage",
    fieldKeys: [
      "strategicGoals", "kpis", "objectives", "strategicTheme", "valueStream",
      "strategicContribution", "expectedBenefit", "benefitRealised",
    ],
    unlocks: "Goals, KPIs, OKRs and value-stream alignment held in your database.",
  },
];

/** A resolved self-host domain: the spec plus its concrete `FieldDescriptor`s from the registry. */
export interface SelfHostDomain {
  id: SelfHostDomainId;
  label: string;
  core: boolean;
  gate: GateReason | null;
  unlocks: string;
  /** The canonical fields this domain owns (resolved + validated against FIELD_REGISTRY). */
  fields: FieldDescriptor[];
}

const BY_KEY = new Map(FIELD_REGISTRY.map((f) => [f.key, f]));

/** Resolve one authored spec into a concrete domain, dropping any key the registry doesn't know. */
function resolve(spec: DomainSpec): SelfHostDomain {
  const fields = spec.fieldKeys
    .filter((k) => CANONICAL_FIELD_KEYS.has(k))
    .map((k) => BY_KEY.get(k)!);
  return {
    id: spec.id,
    label: spec.label,
    core: !!spec.core,
    gate: spec.gate ?? null,
    unlocks: spec.unlocks,
    fields,
  };
}

/** The nine adoptable self-host domains, resolved against the live field registry. */
export const SELF_HOST_DOMAINS: readonly SelfHostDomain[] = DOMAIN_SPECS.map(resolve);

/** The governed catalogue id for a domain — namespaced so it never clashes with a module id. */
export function selfHostGovernanceId(id: SelfHostDomainId): string {
  return `selfhost:${id}`;
}

/** Look a domain up by id (throws on an unknown id — ids are a closed set). */
export function domainById(id: SelfHostDomainId): SelfHostDomain {
  const d = SELF_HOST_DOMAINS.find((x) => x.id === id);
  if (!d) throw new Error(`unknown self-host domain: ${id}`);
  return d;
}

/** Every field key any self-host domain can own — the union across all domains. */
export const SELF_HOST_FIELD_KEYS: ReadonlySet<string> = new Set(
  SELF_HOST_DOMAINS.flatMap((d) => d.fields.map((f) => f.key)),
);
