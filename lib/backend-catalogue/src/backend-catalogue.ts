/**
 * BACKEND catalogue — the systems-of-record plane (Jira, OpenProject, SAP, …).
 *
 * Holds the `BACKENDS` array + accessors (getBackend, isEnterpriseBackend,
 * transportOf, backendCatalogue) and the REFERENCE n8n binding types (how each
 * contract action maps to an n8n node / HTTP call). The binding is the n8n-specific
 * transport half; a different broker would attach its own binding to the same
 * neutral manifest (./backend-manifest.ts).
 *
 * The broker-neutral half (identity, capabilities, required env) lives in
 * `./backend-manifest.ts`. This file declares the binding TYPES and exposes the
 * `BACKENDS` array. A concrete entry is `BackendDefinition = BackendManifest &
 * N8nBinding` (kept flat so a backend reads as one object); the generator
 * (`n8n-generator.ts`) consumes the binding.
 *
 * The backend DATA is not a literal here — each vendor is authored as a JSON file
 * under `../vendors/backends/<id>.json` (validated against
 * `../vendors/schema/backend.schema.json`) and embedded into `BACKENDS_DATA` by
 * `scripts/src/gen-vendors.ts`. To add a backend, drop in a verified JSON file.
 *
 * URLs are n8n expressions. They reference:
 *   - `$env.<NAME>`               instance/base URL + secrets
 *   - `$json.body.payload.*`      the action payload (projectId, issueId, …)
 *   - `$json.body.payload.userContext.token`  the active user's bearer (impersonation)
 *
 * These are *reference* mappings — every team should verify paths/fields against
 * their own backend version. They are intentionally easy to tweak post-import.
 */

import type { BackendManifest, ContractAction, BackendTier, TransportMethod } from "./backend-manifest";
import { brokersForTransport } from "./broker-catalogue";
import { backendKeyFormat } from "./key-format";
import { BACKENDS_DATA } from "./vendors.generated";
import { withOverlay } from "./vendor-overlay";

/**
 * An action is implemented either as a raw HTTP call or — preferably, where n8n
 * ships a maintained node for the tool — as that **native n8n node**, so the
 * integration/auth burden lives in n8n rather than in our own mappings.
 */
export interface ActionMapping {
  /** "http" (default) or "n8nNode". */
  kind?: "http" | "n8nNode";

  // ── http transport ──
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** n8n expression for the request URL. */
  url?: string;
  /** n8n expression producing the JSON request body (writes only). */
  body?: string;
  /** Use an n8n-managed predefined credential (OAuth etc.) instead of the
   *  per-user bearer — e.g. "microsoftDynamicsOAuth2Api". */
  credentialType?: string;

  // ── n8nNode transport ──
  /** Node type, e.g. "n8n-nodes-base.asana". */
  node?: string;
  typeVersion?: number;
  /** Node parameters (resource/operation/etc.). */
  parameters?: Record<string, unknown>;

  note?: string;
}

/**
 * The n8n-specific transport for a backend: the per-user auth expression, an
 * optional n8n credential type, and the per-action node/HTTP mappings. This is
 * the half a *different* broker would replace with its own binding type.
 */
export interface N8nBinding {
  /** n8n expression for the Authorization header value (http per-user transport). */
  authHeader: string;
  /** n8n credential type to attach to native nodes / managed-auth HTTP nodes. */
  credentialType?: string;
  actions: Partial<Record<ContractAction, ActionMapping>>;
}

/** A catalogue entry: the broker-neutral manifest plus its n8n binding (flat, so
 *  a backend reads as a single object literal). */
export type BackendDefinition = BackendManifest & N8nBinding;

export const BACKENDS: BackendDefinition[] = BACKENDS_DATA;

/** One backend definition by id, or undefined. */
export function getBackend(id: string): BackendDefinition | undefined {
  return withOverlay("backends", BACKENDS).find((b) => b.id === id);
}

/**
 * Enterprise-tier backends. Generating an importable n8n workflow for these is a
 * premium capability (licence feature `enterprise_workflows`) — they target the
 * large corporate ERPs / scheduling systems that are the paid-for integrations.
 * The standard backends (Jira, OpenProject, GitHub, …) stay free.
 */
const ENTERPRISE_BACKENDS = new Set(["sap", "sap-s4hana-financials", "primavera", "dynamics365", "dynamics365-sales", "msproject", "netsuite", "enterprise", "planview"]);

/** True when a backend is enterprise-tier (premium workflow generation). */
export function isEnterpriseBackend(id: string): boolean {
  return ENTERPRISE_BACKENDS.has(id);
}

/** Backends only an admin may configure (raw SQL / Mongo — arbitrary query power
 *  over internal stores). Backend selection already rides the admin-gated settings
 *  route; this is the explicit, testable signal the gateway/UI consult too. */
export function isAdminOnlyBackend(id: string): boolean {
  return getBackend(id)?.adminOnly === true;
}

/**
 * The integration METHOD for a backend, DERIVED from its binding (single source of
 * truth — can't drift): any native n8n node ⇒ "native-node" (n8n-tied), otherwise
 * plain "http" (portable across n8n / Make / a custom sidecar). This is what lets
 * the catalogue stay a neutral backend list while still saying which brokers reach
 * each one.
 */
export function transportOf(def: BackendDefinition): TransportMethod {
  return Object.values(def.actions).some((m) => m?.kind === "n8nNode") ? "native-node" : "http";
}

/** Lightweight catalogue for the wizard UI (no n8n expressions). */
export function backendCatalogue() {
  return withOverlay("backends", BACKENDS).map((b) => {
    const transport = transportOf(b);
    const kind = b.kind ?? "live";
    return {
      id: b.id,
      label: b.label,
      docsUrl: b.docsUrl,
      via: b.via,
      credentialType: b.credentialType ?? null,
      requiredEnv: b.requiredEnv,
      // The key this backend needs to be reached (explicit JSON override, else
      // derived from the binding) — so the wizard can scaffold the right credential
      // and keyless access can be hard-rejected.
      keyFormat: backendKeyFormat(b),
      actions: Object.keys(b.actions),
      capabilities: b.capabilities,
      notes: b.notes,
      kind,
      // Raw SQL / Mongo are admin-only (technical, arbitrary-query power).
      adminOnly: b.adminOnly ?? false,
      tier: (isEnterpriseBackend(b.id) ? "enterprise" : "standard") as BackendTier,
      // Which integration method + which brokers can reach this backend. An import
      // source is fed through /api/import, not brokered live, so it lists no brokers.
      transport,
      brokers: kind === "import" ? [] : brokersForTransport(transport),
    };
  });
}
