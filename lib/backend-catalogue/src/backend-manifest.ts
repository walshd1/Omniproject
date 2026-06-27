/**
 * Broker-NEUTRAL backend catalogue types.
 *
 * A `BackendManifest` describes WHAT a backend is and what it can do —
 * independent of how it is brokered. The n8n-specific transport (how each
 * contract action maps to an n8n node / HTTP call, the per-user auth expression)
 * lives separately as the `N8nBinding` in `./n8n-backends.ts`. A concrete
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
  notes?: string;
}
