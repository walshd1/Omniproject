/**
 * Canonical field registry — the single source of truth for the work-item fields
 * OmniProject knows how to surface and store above the seam. When a new backend /
 * broker (a new system of record) is wired in, its API is *enumerated* and each
 * field is *reconciled* against this registry: fields already here are wired
 * automatically; fields NOT here are reported as "new", so the registry (and the
 * contract) can be extended deliberately rather than a backend silently carrying
 * a field the rest of the system doesn't understand.
 *
 * This keeps the seam honest: the canonical vocabulary grows by an explicit edit
 * here, driven by what real backends actually expose.
 */

export type FieldType =
  | "string"
  | "text"
  | "number"
  | "date"
  | "enum"
  | "user"
  | "labels"
  | "reference"
  // Precision types for the finance/CRM/service superset (gated like any field).
  | "currency"
  | "percent"
  | "boolean"
  | "duration";

/**
 * The functional group a field belongs to — drives which capability domain gates
 * it (see lib/capabilities.deriveFieldMap). Lets the canonical set grow to cover
 * the state-of-the-art PM/finance/resource superset while staying gated per
 * backend.
 */
export type FieldGroup =
  | "core"
  | "people"
  | "classification"
  | "schedule"
  | "effort"
  | "agile"
  | "financial"
  | "quality" // risk & quality (health/RAG, impact/urgency, blocked)
  | "crm" // CRM/sales (deal value, probability, forecast)
  | "service" // ITSM/service (SLA, CSAT, change)
  | "relationship"
  | "derived";

export interface FieldDescriptor {
  key: string;
  label: string;
  type: FieldType;
  group?: FieldGroup;
  /** Always present on any issue-tracking backend (never gated off). */
  core?: boolean;
  /** Must be provided when creating the owning entity. */
  required?: boolean;
  /** For `type: "reference"`: the entity key this field points at (e.g. "programme"). */
  references?: string;
}

/**
 * Canonical superset of work-item fields the leading PM/finance/resource tools
 * capture (Jira, Asana, Monday, MS Project, Smartsheet, ServiceNow, SAP,
 * Primavera, Wrike, ClickUp, Azure DevOps, …). Every field is gated surface/store
 * per backend, so a backend only sees what it actually supports. Anything NOT
 * here still flows via the custom-field passthrough (see customFields).
 */
export const FIELD_REGISTRY: FieldDescriptor[] = [
  // Core
  { key: "title", label: "Title", type: "string", core: true, required: true, group: "core" },
  { key: "status", label: "Status", type: "enum", core: true, group: "core" },
  { key: "description", label: "Description", type: "text", group: "core" },
  // People
  { key: "assignee", label: "Assignee", type: "user", group: "people" },
  { key: "reporter", label: "Reporter", type: "user", group: "people" },
  { key: "watchers", label: "Watchers", type: "labels", group: "people" },
  // Classification
  { key: "priority", label: "Priority", type: "enum", group: "classification" },
  { key: "labels", label: "Labels", type: "labels", group: "classification" },
  { key: "type", label: "Work item type", type: "enum", group: "classification" },
  { key: "component", label: "Component", type: "string", group: "classification" },
  { key: "resolution", label: "Resolution", type: "enum", group: "classification" },
  { key: "severity", label: "Severity", type: "enum", group: "classification" },
  { key: "fixVersion", label: "Fix version", type: "string", group: "classification" },
  { key: "environment", label: "Environment", type: "string", group: "classification" },
  // Schedule
  { key: "startDate", label: "Start date", type: "date", group: "schedule" },
  { key: "dueDate", label: "Due date", type: "date", group: "schedule" },
  { key: "milestone", label: "Milestone", type: "enum", group: "schedule" },
  { key: "baselineStart", label: "Baseline start", type: "date", group: "schedule" },
  { key: "baselineFinish", label: "Baseline finish", type: "date", group: "schedule" },
  // Effort / time
  { key: "estimateHours", label: "Estimate (h)", type: "number", group: "effort" },
  { key: "loggedHours", label: "Logged (h)", type: "number", group: "effort" },
  { key: "remainingHours", label: "Remaining (h)", type: "number", group: "effort" },
  // Agile
  { key: "storyPoints", label: "Story points", type: "number", group: "agile" },
  { key: "sprint", label: "Sprint", type: "string", group: "agile" },
  { key: "epic", label: "Epic", type: "string", group: "agile" },
  { key: "rank", label: "Rank", type: "number", group: "agile" },
  // Schedule — critical-path / float (best-in-class scheduling tools)
  { key: "actualStart", label: "Actual start", type: "date", group: "schedule" },
  { key: "actualFinish", label: "Actual finish", type: "date", group: "schedule" },
  { key: "totalFloat", label: "Total float", type: "duration", group: "schedule" },
  { key: "criticalPath", label: "On critical path", type: "boolean", group: "schedule" },
  { key: "constraintType", label: "Constraint type", type: "enum", group: "schedule" },
  { key: "slaDueAt", label: "SLA due at", type: "date", group: "service" },
  // Effort — % complete variants
  { key: "originalEstimateHours", label: "Original estimate (h)", type: "number", group: "effort" },
  { key: "percentWorkComplete", label: "% work complete", type: "percent", group: "effort" },
  // Agile — prioritisation frameworks (best-in-class)
  { key: "acceptanceCriteria", label: "Acceptance criteria", type: "text", group: "agile" },
  { key: "businessValue", label: "Business value", type: "number", group: "agile" },
  { key: "riceScore", label: "RICE score", type: "number", group: "agile" },
  { key: "wsjf", label: "WSJF", type: "number", group: "agile" },
  { key: "moscow", label: "MoSCoW", type: "enum", group: "agile" },
  { key: "confidence", label: "Confidence", type: "percent", group: "agile" },
  // Financial (finance backend)
  { key: "budget", label: "Budget", type: "number", group: "financial" },
  { key: "plannedCost", label: "Planned cost", type: "number", group: "financial" },
  { key: "actualCost", label: "Actual cost", type: "number", group: "financial" },
  { key: "currency", label: "Currency", type: "string", group: "financial" },
  { key: "billable", label: "Billable", type: "enum", group: "financial" },
  { key: "costCenter", label: "Cost centre", type: "string", group: "financial" },
  // Financial — earned value (best-in-class EVM)
  { key: "plannedValue", label: "Planned value (PV)", type: "currency", group: "financial" },
  { key: "earnedValue", label: "Earned value (EV)", type: "currency", group: "financial" },
  { key: "budgetAtCompletion", label: "Budget at completion (BAC)", type: "currency", group: "financial" },
  { key: "estimateAtCompletion", label: "Estimate at completion (EAC)", type: "currency", group: "financial" },
  { key: "estimateToComplete", label: "Estimate to complete (ETC)", type: "currency", group: "financial" },
  { key: "costVariance", label: "Cost variance (CV)", type: "currency", group: "financial" },
  { key: "scheduleVariance", label: "Schedule variance (SV)", type: "currency", group: "financial" },
  { key: "costPerformanceIndex", label: "CPI", type: "number", group: "financial" },
  { key: "schedulePerformanceIndex", label: "SPI", type: "number", group: "financial" },
  // Financial — billing & cost (best-in-class PSA)
  { key: "billRate", label: "Bill rate", type: "currency", group: "financial" },
  { key: "costRate", label: "Cost rate", type: "currency", group: "financial" },
  { key: "committedCost", label: "Committed cost (PO)", type: "currency", group: "financial" },
  { key: "purchaseOrder", label: "Purchase order", type: "string", group: "financial" },
  { key: "revenue", label: "Revenue", type: "currency", group: "financial" },
  { key: "invoicedAmount", label: "Invoiced", type: "currency", group: "financial" },
  { key: "margin", label: "Margin", type: "percent", group: "financial" },
  { key: "capitalised", label: "Capitalised (capex)", type: "boolean", group: "financial" },
  { key: "wbsCode", label: "WBS code", type: "string", group: "financial" },
  // Risk & quality (best-in-class delivery health)
  { key: "healthStatus", label: "Health (RAG)", type: "enum", group: "quality" },
  { key: "riskLevel", label: "Risk level", type: "enum", group: "quality" },
  { key: "impact", label: "Impact", type: "enum", group: "quality" },
  { key: "urgency", label: "Urgency", type: "enum", group: "quality" },
  { key: "blocked", label: "Blocked", type: "boolean", group: "quality" },
  { key: "blockedReason", label: "Blocked reason", type: "string", group: "quality" },
  { key: "mitigation", label: "Mitigation", type: "text", group: "quality" },
  { key: "defectCount", label: "Defect count", type: "number", group: "quality" },
  // CRM / sales
  { key: "dealValue", label: "Deal value", type: "currency", group: "crm" },
  { key: "dealProbability", label: "Win probability", type: "percent", group: "crm" },
  { key: "forecastProbability", label: "Forecast probability", type: "percent", group: "crm" },
  { key: "forecastCategory", label: "Forecast category", type: "enum", group: "crm" },
  { key: "dealStatus", label: "Deal status", type: "enum", group: "crm" },
  { key: "dealStage", label: "Deal stage", type: "reference", references: "pipeline", group: "crm" },
  { key: "pipeline", label: "Pipeline", type: "reference", references: "pipeline", group: "crm" },
  { key: "dealOwner", label: "Deal owner", type: "user", group: "crm" },
  { key: "account", label: "Account", type: "reference", references: "account", group: "crm" },
  { key: "contact", label: "Contact", type: "reference", references: "contact", group: "crm" },
  { key: "leadSource", label: "Lead source", type: "enum", group: "crm" },
  { key: "nextStep", label: "Next step", type: "string", group: "crm" },
  { key: "expectedCloseDate", label: "Expected close date", type: "date", group: "crm" },
  // Service / ITSM
  { key: "slaBreached", label: "SLA breached", type: "boolean", group: "service" },
  { key: "firstResponseAt", label: "First response at", type: "date", group: "service" },
  { key: "resolvedAt", label: "Resolved at", type: "date", group: "service" },
  { key: "reopenCount", label: "Reopen count", type: "number", group: "service" },
  { key: "csatScore", label: "CSAT score", type: "number", group: "service" },
  { key: "csatComment", label: "CSAT comment", type: "text", group: "service" },
  { key: "sentiment", label: "Sentiment", type: "enum", group: "service" },
  { key: "channel", label: "Channel", type: "enum", group: "service" },
  { key: "requester", label: "Requester", type: "user", group: "service" },
  { key: "affectedService", label: "Affected service", type: "reference", references: "service", group: "service" },
  { key: "changeType", label: "Change type", type: "enum", group: "service" },
  // Relationships
  { key: "programmeId", label: "Programme", type: "reference", references: "programme", group: "relationship" },
  { key: "parentTask", label: "Parent", type: "reference", references: "task", group: "relationship" },
  { key: "dependsOn", label: "Depends on", type: "reference", references: "task", group: "relationship" },
  { key: "blocks", label: "Blocks", type: "reference", references: "task", group: "relationship" },
  { key: "relatesTo", label: "Relates to", type: "reference", references: "task", group: "relationship" },
  { key: "duplicateOf", label: "Duplicate of", type: "reference", references: "task", group: "relationship" },
  // Derived / rolled-up (read-only)
  { key: "completionPct", label: "Completion %", type: "number", group: "derived" },
  { key: "weightedValue", label: "Weighted value", type: "currency", group: "derived" },
  { key: "forecastAmount", label: "Forecast amount", type: "currency", group: "derived" },
  { key: "expectedRevenue", label: "Expected revenue", type: "currency", group: "derived" },
];

export const CANONICAL_FIELD_KEYS: ReadonlySet<string> = new Set(FIELD_REGISTRY.map((f) => f.key));

/** A field a backend reports it can expose, from API enumeration during wiring. */
export interface EnumeratedField {
  key: string;
  label?: string;
  type?: string;
  surface?: boolean;
  store?: boolean;
  /** If the backend's API schema says this field references another entity. */
  references?: string;
  /** The system of record this field is read from (e.g. "jira", "openproject").
   *  Lets the UI show granular lineage: "this canonical field ← that backend." */
  sourceSystem?: string;
  /** The backend's NATIVE field name/id this canonical field maps from (e.g.
   *  "duedate", "customfield_10016") — supplied by the broker/workflow, so the
   *  overlay can say exactly which backend field a value came from. */
  sourceField?: string;
}

export interface FieldReconciliation {
  /** Enumerated fields already in the canonical registry — wired automatically. */
  known: string[];
  /** Enumerated fields NOT in the registry — must be added to the registry to be
   *  first-class, or they stay carried as opaque extension fields. */
  unknown: string[];
  /** Canonical fields this backend did not enumerate — informational (the UI
   *  will simply gate them off for this backend). */
  missing: string[];
}

/**
 * Diff an enumerated backend API against the canonical registry. The `unknown`
 * list is the actionable output: each is a candidate to add to FIELD_REGISTRY
 * (and the contract) so the new system of record is fully understood.
 */
export function reconcileFields(enumerated: EnumeratedField[]): FieldReconciliation {
  const known: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const f of enumerated) {
    if (!f.key || seen.has(f.key)) continue;
    seen.add(f.key);
    (CANONICAL_FIELD_KEYS.has(f.key) ? known : unknown).push(f.key);
  }
  const missing = [...CANONICAL_FIELD_KEYS].filter((k) => !seen.has(k));
  return { known, unknown, missing };
}

/**
 * The discovered NON-canonical fields, with their metadata preserved, deduped by
 * key. These are exactly the tenant/custom fields a backend's describe surfaces
 * that the registry doesn't model — carried through verbatim as gated custom
 * fields (`Issue.customFields`) so ANY field a backend captures lights up without
 * a registry edit. Type defaults to "string" when the backend doesn't say.
 */
export function customFieldsFrom(enumerated: EnumeratedField[]): EnumeratedField[] {
  const out: EnumeratedField[] = [];
  const seen = new Set<string>();
  for (const f of enumerated) {
    if (!f.key || seen.has(f.key) || CANONICAL_FIELD_KEYS.has(f.key)) continue;
    seen.add(f.key);
    out.push({ key: f.key, label: f.label ?? f.key, type: f.type ?? "string", surface: f.surface ?? true, store: f.store ?? false, ...(f.references ? { references: f.references } : {}), ...(f.sourceSystem ? { sourceSystem: f.sourceSystem } : {}), ...(f.sourceField ? { sourceField: f.sourceField } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Relationships — how fields/entities relate, so creation dialogs can enforce
// the backend's actual model (not just per-field validity).
// ---------------------------------------------------------------------------

/** A "belongs to" relationship: `field` on an item points at entity `references`. */
export interface RelationshipEdge {
  field: string;
  references: string; // entity key
  kind: "belongs_to";
}

/** Derive the known relationship model from the registry's reference fields. */
export function relationships(): RelationshipEdge[] {
  return FIELD_REGISTRY.filter((f) => f.type === "reference" && f.references).map((f) => ({
    field: f.key,
    references: f.references!,
    kind: "belongs_to" as const,
  }));
}

/**
 * Best-effort discovery of relationships among *unknown* (newly enumerated)
 * fields. Explicit `references` from the backend's API schema win; otherwise a
 * conservative heuristic flags `<entity>Id` / `<entity>Ref` keys that match a
 * known entity. These are **candidates for confirmation**, never auto-applied —
 * the registry is still extended by a deliberate edit.
 */
export function inferRelationshipCandidates(
  enumerated: EnumeratedField[],
  entityKeys: readonly string[],
): RelationshipEdge[] {
  const out: RelationshipEdge[] = [];
  const entities = new Set(entityKeys.map((e) => e.toLowerCase()));
  for (const f of enumerated) {
    if (CANONICAL_FIELD_KEYS.has(f.key)) continue; // only reason about new fields
    if (f.references && entities.has(f.references.toLowerCase())) {
      out.push({ field: f.key, references: f.references, kind: "belongs_to" });
      continue;
    }
    const m = /^(.*?)(?:Id|Ref|Key)$/.exec(f.key);
    if (m && m[1] && entities.has(m[1].toLowerCase())) {
      out.push({ field: f.key, references: m[1].toLowerCase(), kind: "belongs_to" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation — enforce required fields and referential integrity on create/update,
// so the add-project / add-programme dialogs can't violate the backend's model.
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate an entity input against the registry: required fields present, and
 * reference fields point at an entity id that actually exists (referential
 * integrity). `knownRefs` maps an entity key to the set of valid ids in context.
 * Returns [] when valid. Authoritative on the gateway; the SPA dialog mirrors it
 * from the same descriptors for instant feedback.
 */
export function validateEntityInput(
  input: Record<string, unknown>,
  descriptors: FieldDescriptor[],
  knownRefs: Record<string, ReadonlySet<string>> = {},
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const d of descriptors) {
    const value = input[d.key];
    const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
    if (d.required && empty) {
      errors.push({ field: d.key, message: `${d.label} is required` });
      continue;
    }
    if (d.type === "reference" && d.references && !empty) {
      const valid = knownRefs[d.references];
      if (valid && !valid.has(String(value))) {
        errors.push({ field: d.key, message: `${d.label} must reference an existing ${d.references}` });
      }
    }
  }
  return errors;
}
