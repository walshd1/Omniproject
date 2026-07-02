/**
 * BACKEND catalogue — the systems-of-record plane (Jira, OpenProject, SAP, …).
 *
 * Holds the `BACKENDS` array + accessors (getBackend, isEnterpriseBackend,
 * transportOf, backendCatalogue) and the broker binding types (how each
 * contract action maps to a broker-native node / HTTP call). The binding is the
 * broker-specific transport half; a different broker would attach its own binding
 * shape to the same neutral manifest (./backend-manifest.ts) — today's reference
 * implementation of that shape happens to be n8n's (see `n8n-generator.ts`, the
 * one place permitted to know n8n's concrete node/expression syntax).
 *
 * The broker-neutral half (identity, capabilities, required env) lives in
 * `./backend-manifest.ts`. This file declares the binding TYPES and exposes the
 * `BACKENDS` array. A concrete entry is `BackendDefinition = BackendManifest &
 * BrokerBinding` (kept flat so a backend reads as one object); the generator
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
 * An action is implemented either as a raw HTTP call or — preferably, where the
 * connected broker ships a maintained node for the tool — as that **native
 * broker node**, so the integration/auth burden lives in the broker rather than
 * in our own mappings. The `"n8nNode"` value names n8n's own native-node
 * transport specifically (the reference broker); a future adapter for a
 * different broker would introduce its own sibling value here rather than
 * reusing n8n's.
 */
export interface ActionMapping {
  /** "http" (default) or "n8nNode" (n8n's native-node transport). */
  kind?: "http" | "n8nNode";

  // ── http transport ──
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Broker expression for the request URL. */
  url?: string;
  /** Broker expression producing the JSON request body (writes only). */
  body?: string;
  /** Use a broker-managed predefined credential (OAuth etc.) instead of the
   *  per-user bearer — e.g. "microsoftDynamicsOAuth2Api". */
  credentialType?: string;

  // ── n8nNode transport ──
  /** Node type, e.g. "n8n-nodes-base.asana" (n8n-specific — only meaningful for the n8nNode kind). */
  node?: string;
  typeVersion?: number;
  /** Node parameters (resource/operation/etc.). */
  parameters?: Record<string, unknown>;

  note?: string;
}

/** The two transport kinds an {@link ActionMapping} can declare — exported as a runtime value
 *  (not just the `kind` union above) so authoring UIs can enumerate them without hand-typing
 *  the broker-specific literal themselves. */
export const ACTION_KINDS: NonNullable<ActionMapping["kind"]>[] = ["http", "n8nNode"];

/**
 * The broker transport for a backend: the per-user auth expression, an optional
 * broker-managed credential type, and the per-action node/HTTP mappings. This is
 * the half a *different* broker would replace with its own binding type — n8n is
 * the reference implementation (the field-level doc comments below describe its
 * expression syntax since that's the concrete broker wired up today).
 */
export interface BrokerBinding {
  /** Broker expression for the Authorization header value (http per-user transport). */
  authHeader: string;
  /** Broker-managed credential type to attach to native nodes / managed-auth HTTP nodes. */
  credentialType?: string;
  actions: Partial<Record<ContractAction, ActionMapping>>;
}

/** A catalogue entry: the broker-neutral manifest plus its broker binding (flat, so
 *  a backend reads as a single object literal). */
export type BackendDefinition = BackendManifest & BrokerBinding;

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
const ENTERPRISE_BACKENDS = new Set(["sap", "primavera", "dynamics365", "dynamics365-sales", "dynamics365-fo", "msproject", "netsuite", "enterprise", "planview", "oracle-fusion-erp"]);

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
