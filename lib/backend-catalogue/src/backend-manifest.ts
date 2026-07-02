/**
 * Broker-NEUTRAL backend catalogue types.
 *
 * A `BackendManifest` describes WHAT a backend is and what it can do —
 * independent of how it is brokered. The n8n-specific transport (how each
 * contract action maps to an n8n node / HTTP call, the per-user auth expression)
 * lives separately as the `N8nBinding` in `./backend-catalogue.ts`. A concrete
 * catalogue entry (`BackendDefinition`) is a manifest **plus** a binding.
 *
 * This is the seam to cut along when a second broker arrives: a non-n8n broker
 * (a DB sidecar, a bespoke HTTP service) would attach its OWN binding type to the
 * same neutral manifest, and the catalogue/UI keep working unchanged because they
 * only consume the neutral half (see `backendCatalogue`).
 */

/** The contract actions a backend must implement (broker-neutral). */
export type ContractAction =
  | "list_projects"
  | "list_issues"
  | "create_issue"
  | "update_issue"
  | "delete_issue"
  | "get_capabilities";

/** Catalogue tier — enterprise backends gate the premium workflow generation. */
export type BackendTier = "standard" | "enterprise";

/**
 * How a backend is reached — the integration METHOD, broker-neutral:
 *  - "http"        a plain REST API. Portable across ANY HTTP-capable broker
 *                  (n8n, Make, or a custom sidecar).
 *  - "native-node" an n8n maintained node carries the auth/integration. Tied to
 *                  n8n unless you rebuild it as HTTP modules for another broker.
 */
export type TransportMethod = "http" | "native-node";

/**
 * The shape of the key required to reach a backend or broker — declared in its JSON
 * so keyless access can be hard-rejected and credentials scaffolded (the value itself
 * is NEVER stored by OmniProject; this only describes where the operator's key lives
 * and what it must look like).
 */
export interface KeyFormat {
  /** The auth scheme the target expects. "none" = genuinely keyless (e.g. demo). */
  scheme: "psk" | "bearer" | "apiKey" | "basic" | "oauth2" | "per-user" | "none";
  /** Operator-side env var(s) the key lives in. */
  env?: string[];
  /** HTTP header the key is presented in, if any. */
  header?: string;
  /** Optional regex the key value must match (its format). */
  pattern?: string;
}

// The broker registry (which brokers can serve a transport) lives in
// ./broker-catalogue.ts — brokers are their own plane, derived from broker
// capabilities rather than hardcoded here, so the two stay separate but linked.

/**
 * The broker-neutral description of a backend: identity, where it's documented,
 * what an operator must configure, and which capability domains it can populate.
 * No transport specifics (no n8n nodes, URLs or auth expressions) live here.
 */
export interface BackendManifest {
  id: string;
  label: string;
  docsUrl: string;
  /** How this backend authenticates / is wired — human-readable, for the wizard UI. */
  via: string;
  /** Env vars the operator must set for this backend. */
  requiredEnv: string[];
  /** Default capability flags this backend can populate out of the box. */
  capabilities: Record<string, boolean>;
  /**
   * What kind of source this is:
   *  - "live"     (default) a SaaS/HTTP API brokered continuously.
   *  - "import"   a one-shot tabular source (Excel/CSV) — fed through the column
   *               mapper + /api/import, NOT brokered live.
   *  - "database" a direct datastore (SQL/Mongo) reached via an HTTP sidecar that
   *               holds the connection — for internally-hosted / legacy systems.
   */
  kind?: "live" | "import" | "database";
  /**
   * Sensitive/technical backend that ONLY an admin may configure. Raw SQL and
   * MongoDB give arbitrary query power over internal stores, so they are gated to
   * admin — defence-in-depth on top of the already admin-gated settings route, and
   * a UX signal that this is a technical, not a business, integration.
   */
  adminOnly?: boolean;
  /** The shape of the key required to reach this backend (declared in its JSON), so
   *  keyless access can be hard-rejected and credentials scaffolded. */
  keyFormat?: KeyFormat;
  notes?: string;
  /**
   * Canonical field-registry keys this backend maps/exposes — MUST be a strict
   * subset of the field superset (`assets/fields.json` + every backend's
   * contributed `fields[]`), enforced by the `guard-superset` CI check. Lets a
   * vendor JSON declare which canonical fields (budget, wbsCode, …) its real API
   * genuinely populates, reusing the registry instead of duplicating field
   * definitions per backend.
   */
  fieldKeys?: string[];
  /**
   * Canonical fields this backend CONTRIBUTES to the superset (when its API
   * exposes something not yet in the registry) — merged in by `gen-fields`,
   * validated against `assets/schema/field.schema.json`, deduped by key.
   */
  fields?: Array<Record<string, unknown>>;
  /**
   * Optional VOCAB MAPS — how this vendor names things, so a customer used to its
   * nomenclature can adopt it as a shortcut instead of re-typing labels by hand.
   *
   *  - nomenclature: canonical UI-term key (the `labels` catalogue keys, e.g.
   *    "term.issue") → this vendor's word (e.g. "Ticket" for Zendesk, "Incident"
   *    for ServiceNow). The gateway offers it as a one-click preset that populates
   *    the label overrides; unknown keys are dropped on apply.
   *  - statusVocabulary: this vendor's native status value → a canonical status,
   *    so its dialect is mapped to canonical BELOW the seam as data. `fromCanonical`
   *    is the reverse for writes.
   */
  nomenclature?: Record<string, string>;
  statusVocabulary?: {
    toCanonical: Record<string, string>;
    fromCanonical?: Record<string, string>;
  };
}
