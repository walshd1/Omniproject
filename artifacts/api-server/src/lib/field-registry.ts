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

export type FieldType = "string" | "text" | "number" | "date" | "enum" | "user" | "labels" | "reference";

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
  // Financial (finance backend)
  { key: "budget", label: "Budget", type: "number", group: "financial" },
  { key: "plannedCost", label: "Planned cost", type: "number", group: "financial" },
  { key: "actualCost", label: "Actual cost", type: "number", group: "financial" },
  { key: "currency", label: "Currency", type: "string", group: "financial" },
  { key: "billable", label: "Billable", type: "enum", group: "financial" },
  { key: "costCenter", label: "Cost centre", type: "string", group: "financial" },
  // Relationships
  { key: "programmeId", label: "Programme", type: "reference", references: "programme", group: "relationship" },
  { key: "parentTask", label: "Parent", type: "reference", references: "task", group: "relationship" },
  { key: "dependsOn", label: "Depends on", type: "reference", references: "task", group: "relationship" },
  // Derived / rolled-up (read-only)
  { key: "completionPct", label: "Completion %", type: "number", group: "derived" },
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
