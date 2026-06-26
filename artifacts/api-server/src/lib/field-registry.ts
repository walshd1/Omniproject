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

export type FieldType = "string" | "text" | "number" | "date" | "enum" | "user" | "labels";

export interface FieldDescriptor {
  key: string;
  label: string;
  type: FieldType;
  /** Always present on any issue-tracking backend (never gated off). */
  core?: boolean;
}

export const FIELD_REGISTRY: FieldDescriptor[] = [
  { key: "title", label: "Title", type: "string", core: true },
  { key: "status", label: "Status", type: "enum", core: true },
  { key: "priority", label: "Priority", type: "enum" },
  { key: "assignee", label: "Assignee", type: "user" },
  { key: "description", label: "Description", type: "text" },
  { key: "labels", label: "Labels", type: "labels" },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "dueDate", label: "Due date", type: "date" },
  { key: "storyPoints", label: "Story points", type: "number" },
  { key: "completionPct", label: "Completion %", type: "number" },
  { key: "programmeId", label: "Programme", type: "string" },
];

export const CANONICAL_FIELD_KEYS: ReadonlySet<string> = new Set(FIELD_REGISTRY.map((f) => f.key));

/** A field a backend reports it can expose, from API enumeration during wiring. */
export interface EnumeratedField {
  key: string;
  label?: string;
  type?: string;
  surface?: boolean;
  store?: boolean;
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
