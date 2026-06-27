/**
 * Broker contract — the published, versioned interface.
 *
 * OmniProject is broker-agnostic by design: this file plus ./types.ts ARE the
 * real interface a broker must satisfy. n8n is the reference broker (see
 * ./n8n.ts); DemoBroker (./demo.ts) is the reference in-process implementation
 * that proves the seam is generic. The human- and machine-readable contract
 * under docs/contract/ is GENERATED from these declarations
 * (scripts/src/gen-contract.ts) so the docs can never drift from the code.
 *
 * ./types.ts carries the normalised DOMAIN entities (Project, Issue, …). This
 * file carries the WIRE protocol that wraps them: the response envelope,
 * provenance vocabulary, control semantics (the headers/fields that drive
 * dry-run, optimistic concurrency, idempotency and the origin loop-guard),
 * the inbound notification-ingest body, and the outbound HMAC-signed event
 * shape. Everything a second broker implementer needs is here.
 */

/**
 * The contract version. Bump only on a breaking change to a request/response
 * shape or control semantic; additive fields are NOT breaking. The generated
 * schema file and GET /api/contract both report this.
 */
export const CONTRACT_VERSION = "v1" as const;
export type ContractVersion = typeof CONTRACT_VERSION;

// ── Response envelope ────────────────────────────────────────────────────────

/**
 * The wire envelope an HTTP-transport broker returns. The gateway unwraps it
 * before anything above the seam sees data; a bare body (no `success` key) is
 * treated as `{ success: true, data: <body> }`. In-process brokers (DemoBroker)
 * return domain values directly and never construct an envelope — the envelope
 * is the reference HTTP binding, not a domain concept.
 */
export interface BrokerEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  message?: string | null;
}

// ── Provenance ───────────────────────────────────────────────────────────────

/**
 * Every derived/historical response carries a provenance tag so a consumer can
 * tell fact from estimate. Not every value is valid on every field — the
 * narrower per-entity unions in ./types.ts are authoritative (e.g. FxRates is
 * only ever "sourced" | "sample"). This is the full documented vocabulary.
 *
 *  - sourced   — read straight from the backend system of record (fact).
 *  - derived   — computed by the gateway from sourced data (e.g. a roll-up).
 *  - sample    — demo/sample data; never real.
 *  - replayed  — a real recorded state read back from the logging server.
 *  - projected — a model of the future; never fact.
 */
export const PROVENANCE_VALUES = ["sourced", "derived", "sample", "replayed", "projected"] as const;
export type Provenance = (typeof PROVENANCE_VALUES)[number];

// ── Control semantics ────────────────────────────────────────────────────────

/** The gateway tags every UI-initiated change with this origin (loop-guard). */
export const GATEWAY_ORIGIN = "omniproject" as const;

/**
 * Headers the gateway sends to a broker on every action. A broker SHOULD echo
 * `Origin` back on any event it emits so the gateway can drop its own echoes,
 * and MAY use `Idempotency-Key` to collapse duplicate triggers.
 */
export const REQUEST_HEADERS = {
  /** Backend routing hint (which system of record). */
  source: "X-OmniProject-Source",
  /** The broker action being invoked (e.g. "create_issue"). */
  action: "X-OmniProject-Action",
  /** Loop-guard: identifies the gateway as the change origin. */
  origin: "X-OmniProject-Origin",
  /** Deduplication token (see idempotencyKey). */
  idempotencyKey: "X-OmniProject-Idempotency-Key",
} as const;

/**
 * Control fields carried IN the request body / write payloads, documented here
 * so a broker implementer has one place to look.
 *
 *  - verify          — dry-run: probe the contract WITHOUT mutating (see VerifyReport).
 *  - expectedVersion — optimistic concurrency; a mismatch MUST surface as 409.
 *  - origin          — loop-guard tag, mirrors REQUEST_HEADERS.origin.
 *  - idempotencyKey  — mirrors REQUEST_HEADERS.idempotencyKey, also in the body.
 */
export const CONTROL_FIELDS = {
  verify: "verify",
  expectedVersion: "expectedVersion",
  origin: "origin",
  idempotencyKey: "idempotencyKey",
} as const;

/** The HTTP status a broker MUST return on an optimistic-concurrency conflict. */
export const CONFLICT_STATUS = 409 as const;

// ── Inbound notification ingest ──────────────────────────────────────────────

/**
 * Body of POST /api/notifications/ingest — a broker/tool pushes an event in.
 * Authenticated by the NOTIFY_INGEST_SECRET shared secret (Bearer or
 * X-Notify-Secret header). `notification.title` is the only required field.
 */
export interface NotificationIngest {
  target?: {
    sub?: string;
    email?: string;
    role?: string;
  };
  notification: {
    id?: string;
    kind?: string;
    title: string;
    body?: string | null;
    projectId?: string | null;
    issueId?: string | null;
  };
}

/** The normalised notification the gateway fans out after ingest. */
export interface IngestedNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  projectId: string | null;
  issueId: string | null;
  read: boolean;
  timestamp: string;
}

// ── Outbound HMAC-signed events ──────────────────────────────────────────────

/** The events the gateway can push to subscribed endpoints. */
export const OUTBOUND_EVENT_NAMES = ["notification", "audit", "config.changed", "webhook.test"] as const;
export type OutboundEventName = (typeof OUTBOUND_EVENT_NAMES)[number];

/** The JSON body of every outbound delivery. */
export interface OutboundEvent<T = unknown> {
  event: OutboundEventName;
  deliveredAt: string;
  deliveryId: string;
  data: T;
}

/**
 * Headers on every outbound delivery. The signature is
 * `sha256=<hex HMAC-SHA256(body, subscription.secret)>` over the exact
 * serialised body — receivers verify by recomputing it.
 */
export const OUTBOUND_HEADERS = {
  event: "X-OmniProject-Event",
  delivery: "X-OmniProject-Delivery",
  signature: "X-OmniProject-Signature",
} as const;

/** The signature scheme prefix (algorithm tag) on OUTBOUND_HEADERS.signature. */
export const SIGNATURE_SCHEME = "sha256" as const;

// ── Canonical value vocabularies ─────────────────────────────────────────────
// The cross-backend meanings (status/priority/RAG) a broker normalises into.
// Defined in ./vocabulary.ts and surfaced here so they're part of the one
// published contract import surface. Wire fields stay open strings — these are
// the canonical tokens the gateway classifies into, plus the typed StatusVocabulary
// a backend declares to map its dialect below the seam.
export {
  CANONICAL_STATUS,
  STATUS_CLASS,
  CANONICAL_PRIORITY,
  RAG_STATUSES,
} from "./vocabulary";
export type {
  CanonicalStatus,
  StatusClass,
  CanonicalPriority,
  RagStatus,
  StatusVocabulary,
} from "./vocabulary";

// ── Single import surface ────────────────────────────────────────────────────
// Re-export the domain entity + Broker types so a contract consumer (or the
// generator) has one place to import the whole published surface from.
export type {
  Broker,
  ActorContext,
  Row,
  Project,
  ProjectWrite,
  Issue,
  IssueWrite,
  TaskItem,
  TaskItemWrite,
  ProjectMember,
  ResourceMember,
  Summary,
  HistoryPoint,
  HistoryState,
  Baseline,
  PortfolioRow,
  FxRates,
  CapabilityFlags,
  FieldSupport,
  BackendFieldMap,
  VerifyReport,
  BrokerErrorCode,
} from "./types";
