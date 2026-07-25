/**
 * Broker-NEUTRAL backend catalogue types.
 *
 * A `BackendManifest` describes WHAT a backend is and what it can do —
 * independent of how it is brokered. The broker-specific transport (how each
 * contract action maps to a broker-native node / HTTP call, the per-user auth
 * expression) lives separately as the `BrokerBinding` in `./backend-catalogue.ts`
 * (n8n is today's reference implementation of that binding shape). A concrete
 * catalogue entry (`BackendDefinition`) is a manifest **plus** a binding.
 *
 * This is the seam to cut along when a second broker arrives: a different broker
 * (a DB sidecar, a bespoke HTTP service) would attach its OWN binding type to the
 * same neutral manifest, and the catalogue/UI keep working unchanged because they
 * only consume the neutral half (see `backendCatalogue`).
 */

/**
 * The contract actions a backend can implement (broker-neutral). A backend implements a SUBSET (the `actions`
 * map is Partial) — a project tool maps the issue/project verbs; a billing system of record (Invoice Ninja,
 * Dolibarr, …) maps the invoice verbs. Finance verbs are gated by the `financials` capability domain.
 */
export type ContractAction =
  | "list_projects"
  | "list_issues"
  | "create_issue"
  | "update_issue"
  | "delete_issue"
  // ── Billing / finance system-of-record (capability: financials) ──
  | "create_invoice"
  | "update_invoice"
  | "get_invoice"
  | "list_invoices"
  // ── Client / customer master (finance superset F1) — the bill-to party a finance backend owns ──
  | "list_clients"
  | "get_client"
  | "create_client"
  | "update_client"
  // ── Product / item catalogue (finance superset F2) — the priced line items invoices/quotes draw from ──
  | "list_products"
  | "get_product"
  | "create_product"
  | "update_product"
  // ── Payment / receipt (finance superset F3) — a settlement applied against invoices (AR receipt) ──
  | "list_payments"
  | "get_payment"
  | "create_payment"
  // ── Credit note + quote/estimate (finance superset F4) — AR completeness ──
  | "list_credit_notes"
  | "get_credit_note"
  | "create_credit_note"
  | "list_quotes"
  | "get_quote"
  | "create_quote"
  | "update_quote"
  // ── Tax rate (finance superset F5) — a jurisdiction's tax rate applied to invoice/quote lines ──
  | "list_tax_rates"
  | "get_tax_rate"
  | "create_tax_rate"
  | "update_tax_rate"
  // ── Accounts payable spine (finance superset F6) — vendor, expense, bill (vendor invoice), PO ──
  | "list_vendors"
  | "get_vendor"
  | "create_vendor"
  | "update_vendor"
  | "list_expenses"
  | "get_expense"
  | "create_expense"
  | "update_expense"
  | "list_bills"
  | "get_bill"
  | "create_bill"
  | "list_purchase_orders"
  | "get_purchase_order"
  | "create_purchase_order"
  | "update_purchase_order"
  | "get_capabilities";

/** Catalogue tier — enterprise backends gate the premium workflow generation. */
export type BackendTier = "standard" | "enterprise";

/**
 * How confident we are that this manifest is actually correct for the vendor's
 * real, live API — as opposed to merely well-formed and matching public docs:
 *  - "verified"     exercised end-to-end against a live instance of the vendor.
 *  - "catalogued"   built from the vendor's public API docs/schema, matching
 *                   the manifest shape, but not yet run against a live instance.
 *  - "experimental" speculative or partial — a generic placeholder, or an API
 *                   surface we're not even confident about on paper.
 * Surfaced as a badge in the Configurator so an operator knows how much to trust
 * a mapping before wiring it up. See `lib/backend-catalogue/vendors/README.md`
 * for the catalogue-freeze policy this backs.
 *
 * PURELY an honesty/UI signal, self-declared in JSON — never a trust boundary.
 * Nothing in the gateway/broker may consult it to gate a capability, skip a
 * warning, or auto-grant anything; it carries no more authority than `notes`.
 */
export const VERIFICATION_STATUSES = ["verified", "catalogued", "experimental"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

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
/**
 * The PRIMARY record a backend is a system of record FOR. A backend isn't forced to be a project tool — but it
 * must declare which record it owns, because that decides which contract READ verbs it must implement (see
 * {@link RECORD_TYPE_REQUIRED_READS}). Today: `issue` (PM/CRM/ITSM/ERP tools, normalised to the issue/project
 * contract) or `invoice` (a billing system of record like Invoice Ninja / Dolibarr) or `client` (a customer
 * master — a CRM/billing system whose primary record is the bill-to party) or `product` (an item catalogue
 * whose primary record is the priced line item) or `payment` (an AR-receipt system whose primary record is a
 * settlement applied to invoices) or `credit_note` / `quote` (AR documents — a credit against an account, an
 * estimate that precedes an invoice) or `tax_rate` (a jurisdiction's tax-rate table) or an accounts-payable
 * record — `vendor` (supplier master), `expense` (a cost), `bill` (a vendor invoice) or `purchase_order`.
 * Extend as new record domains land.
 *
 * NOTE: the field superset is ONE universal registry — the union of `assets/fields.json` and EVERY backend's
 * contributed `fields[]` — so whatever any backend can provide maps through to the standard surface. It is NOT
 * scoped per record type; `primaryRecord` governs required actions, not which fields exist.
 */
export const BACKEND_RECORD_TYPES = ["issue", "invoice", "client", "product", "payment", "credit_note", "quote", "tax_rate", "vendor", "expense", "bill", "purchase_order"] as const;
export type BackendRecordType = (typeof BACKEND_RECORD_TYPES)[number];

/** The contract READ verbs a backend of each primary-record type must implement (the verifier enforces this).
 *  An `issue` backend must expose projects + issues; an `invoice` backend must expose its invoice list; a
 *  `client` (customer-master) backend must expose its client list; a `product` (item-catalogue) backend must
 *  expose its product list; a `payment` (AR-receipt) backend must expose its payment list; a `credit_note` /
 *  `quote` backend must expose its own list; a `tax_rate` backend must expose its tax-rate table. */
export const RECORD_TYPE_REQUIRED_READS: Record<BackendRecordType, ContractAction[]> = {
  issue: ["list_projects", "list_issues"],
  invoice: ["list_invoices"],
  client: ["list_clients"],
  product: ["list_products"],
  payment: ["list_payments"],
  credit_note: ["list_credit_notes"],
  quote: ["list_quotes"],
  tax_rate: ["list_tax_rates"],
  vendor: ["list_vendors"],
  expense: ["list_expenses"],
  bill: ["list_bills"],
  purchase_order: ["list_purchase_orders"],
};

export interface BackendManifest {
  id: string;
  label: string;
  docsUrl: string;
  /**
   * The primary record this backend is a system of record for (`issue` | `invoice`). Decides the required
   * contract read verbs (see {@link RECORD_TYPE_REQUIRED_READS}) and which field superset applies — a backend
   * need not be a project tool, but it must own a record type.
   */
  primaryRecord: BackendRecordType;
  /** How confident we are this manifest matches the real, live vendor API — see {@link VerificationStatus}. */
  verification: VerificationStatus;
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
