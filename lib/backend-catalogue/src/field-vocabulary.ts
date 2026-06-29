/**
 * Canonical FIELD vocabulary — the single source of truth for the work-item fields
 * OmniProject knows how to surface and store above the seam. Authored as JSON
 * (assets/fields.json), validated + embedded by gen-fields, drift-guarded in CI and
 * overlayable per deployment — the same data-not-code pattern as vendors and views.
 *
 * It lives BELOW the seam, with the other canonical vocabularies (status/priority,
 * notification kinds), because it's reference data the gateway, the contract
 * generator and the SPA all read. The gateway's field-registry module re-exports
 * this and adds the reconcile/validate behaviour (which stays above the seam).
 */
import { FIELDS_DATA } from "./fields.generated";

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
 * it (see the gateway's deriveFieldMap). Lets the canonical set grow to cover the
 * state-of-the-art PM/finance/resource superset while staying gated per backend.
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
  | "strategy" // strategic alignment (goals, KPIs, OKRs) — project + programme level
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
  /** The canonical entity (table) this field belongs to; defaults to "issue" when omitted.
   *  Drives which table a field becomes a column on in the superset-native DB schema generator. */
  entity?: string;
}

/**
 * Canonical superset of work-item fields the leading PM/finance/resource tools
 * capture (Jira, Asana, Monday, MS Project, Smartsheet, ServiceNow, SAP, Primavera,
 * Wrike, ClickUp, Azure DevOps, …). Every field is gated surface/store per backend,
 * so a backend only sees what it actually supports. Anything NOT here still flows
 * via the custom-field passthrough.
 */
export const FIELD_REGISTRY: FieldDescriptor[] = FIELDS_DATA;

/** The canonical field keys — the set the reconcile path checks enumerated fields against. */
export const CANONICAL_FIELD_KEYS: ReadonlySet<string> = new Set(FIELD_REGISTRY.map((f) => f.key));
