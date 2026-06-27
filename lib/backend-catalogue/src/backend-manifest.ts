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

/** Brokers that can serve a given transport (which automation layer to point
 *  BROKER_URL at). Make = n8n alternative (synchronous webhook); http-sidecar =
 *  your own service implementing the binding. */
export type BrokerKind = "n8n" | "make" | "http-sidecar";

/** Which brokers can serve a transport method. HTTP is broker-portable; a native
 *  n8n node is n8n-only. Zapier/IFTTT are deliberately absent — they're async and
 *  can't answer the synchronous read-through contract (event edges only). */
export function brokersForTransport(t: TransportMethod): BrokerKind[] {
  return t === "http" ? ["n8n", "make", "http-sidecar"] : ["n8n"];
}

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
  notes?: string;
}
