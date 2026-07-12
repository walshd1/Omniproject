/**
 * Broker boundary — domain contract.
 *
 * This is the seam between OmniProject and whatever fetches/writes the real
 * project data. Everything ABOVE this boundary (route handlers, services, the
 * SPA) talks ONLY to the `Broker` interface in OUR domain vocabulary. No webhook
 * envelope, field name, config var, or error shape that exists only because the
 * default implementation happens to be n8n may appear here — see docs/BROKER.md
 * for the boundary invariants the arch-guard test enforces.
 *
 * n8n is the reference implementation (see ./reference-broker/); DemoBroker (./demo.ts) is
 * the reference in-process implementation that proves the seam is generic. The
 * published, versioned contract these types generate lives in docs/CONTRACT.md.
 */

import type { SessionBind } from "../lib/session-key";
import type { Scope } from "../lib/scope";

/** Loosely-typed record — the normalised row shape the broker exchanges. */
export type Row = Record<string, unknown>;

/** Who initiated an action. Autonomous actors (scheduled jobs, AI agents) are
 *  first-class principals — keyed, RBAC-roled and provenance-bound like a human. */
export type ActorKind = "human" | "automation" | "agent";

/**
 * Forwarded actor identity. A write is performed "as" this principal so the
 * backend system of record authorises it under the real user (not a shared
 * admin key). `authHeader` is the transport credential to forward; `token` is
 * the same access token echoed in the per-user context. Demo brokers ignore both.
 */
export interface ActorContext {
  sub?: string | undefined;
  email?: string | undefined;
  name?: string | undefined;
  role?: string | undefined;
  token?: string | undefined;
  authHeader?: string | undefined;
  /** Binding material for the per-session broker signing key (lib/session-key).
   *  Present for authenticated calls; absent for system/unauthenticated ones (which
   *  fall back to the static broker key). */
  sessionBind?: SessionBind | undefined;
  /** What kind of principal this is (default human). Autonomous actors carry their
   *  own keyed sessionBind + RBAC role, so they're keyed and provenance-bound too. */
  actorKind?: ActorKind;
  /** The principal's forwarded DATA scope (user / programme / all) — the backend confirms it
   *  (it rides in the PSK-signed envelope) and enforces per-user/per-programme access. */
  scope?: Scope | undefined;
  /** For a minted autonomous principal: the invocation time it was minted for (epoch ms),
   *  so a consumer can prove it's fresh and not a replayed/cached context. */
  issuedAt?: number;
  /** For a minted autonomous principal: its (short) expiry — autonomous sessions are
   *  deliberately brief since re-keying is free. */
  expiresAt?: number;
}

/** A normalised project row. */
export interface Project extends Row {
  id: string;
  name: string;
  /** The backend's native project lifecycle status (kept verbatim, like `Issue.status`). Classified
   *  into live/closed by `isProjectLive` (broker/vocabulary); reads are default-live. Absent ⇒ live. */
  status?: string | null;
  /** OmniProject instance ID — a GUID minted by the gateway when the project is created, echoed and
   *  stored by every backend. It is the backend-INDEPENDENT correlation key: the same project seen
   *  through two backends carries the same `omniInstanceId`, so records assemble across backends by it
   *  (whereas `source:id` is unique per backend). Optional because pre-existing rows may lack one. */
  omniInstanceId?: string;
}

/** A normalised issue/work-item row. `version` is the concurrency token. */
export interface Issue extends Row {
  id: string;
  projectId: string;
  title: string;
  status: string;
  version?: number;
  // Optional per-task financials — surfaced only when the backend carries them
  // (capability-gated, "financial" field group). Costs roll up into the project.
  budget?: number | null;
  actualCost?: number | null;
  billable?: boolean | null;
  costCenter?: string | null;
  currency?: string | null;
  // Optional effort / time-tracking — surfaced only when the backend carries
  // them ("effort"/"agile" field groups). Additive; the contract stays v1.
  estimateHours?: number | null;
  loggedHours?: number | null;
  remainingHours?: number | null;
  storyPoints?: number | null;
  // Optional risk & quality — surfaced only when the backend carries them
  // ("quality" field group). Enum-ish values are free-form strings so a backend's
  // own vocabulary (RAG, 1–5, "At risk") is preserved verbatim.
  healthStatus?: string | null;
  riskLevel?: string | null;
  impact?: string | null;
  urgency?: string | null;
  blocked?: boolean | null;
  blockedReason?: string | null;
  mitigation?: string | null;
  defectCount?: number | null;
}

/** A child issue/note raised against a task (the work-item). */
export interface TaskItem extends Row {
  id: string;
  taskId: string;
  kind: "issue" | "note";
  content: string;
  author?: string | null;
  createdAt: string;
}

/** Create a child issue/note on a task. */
export interface TaskItemWrite {
  kind: "issue" | "note";
  content: string;
}

/** A normalised issue mutation. `expectedVersion` drives optimistic concurrency. */
export interface IssueWrite {
  projectId: string;
  issueId?: string | undefined;
  title?: string | undefined;
  description?: string | null | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  assignee?: string | null | undefined;
  labels?: string[] | undefined;
  startDate?: string | Date | null | undefined;
  dueDate?: string | Date | null | undefined;
  // Optional per-task financials (capability-gated, "financial" field group).
  budget?: number | null | undefined;
  actualCost?: number | null | undefined;
  billable?: boolean | null | undefined;
  costCenter?: string | null | undefined;
  currency?: string | null | undefined;
  // Optional effort / time-tracking (capability-gated, "effort"/"agile" groups).
  estimateHours?: number | null | undefined;
  loggedHours?: number | null | undefined;
  remainingHours?: number | null | undefined;
  storyPoints?: number | null | undefined;
  // Optional risk & quality (capability-gated, "quality" group).
  healthStatus?: string | null | undefined;
  riskLevel?: string | null | undefined;
  impact?: string | null | undefined;
  urgency?: string | null | undefined;
  blocked?: boolean | null | undefined;
  blockedReason?: string | null | undefined;
  mitigation?: string | null | undefined;
  defectCount?: number | null | undefined;
  expectedVersion?: number | undefined;
}

/** A person on a project, with their access level (the backend is the source). */
export interface ProjectMember extends Row {
  id: string;
  name?: string | null;
  email?: string | null;
  /** "write" = can be assigned/act on work; "read" = view-only. */
  access: "read" | "write";
  /** Skills/competencies, when the backend tracks them (resource planning). */
  skills?: string[];
  /** Available capacity in hours for the planning window, when tracked. */
  availableHours?: number | null;
  /** Already-allocated hours in the planning window, when tracked. */
  allocatedHours?: number | null;
}

/** A person aggregated across the portfolio, for resource planning. */
export interface ResourceMember {
  id: string;
  name?: string | null;
  email?: string | null;
  /** Union of skills seen across the member's projects. */
  skills: string[];
  /** Summed capacity across projects (null when no backend supplies it). */
  availableHours: number | null;
  allocatedHours: number | null;
  /** Projects this person is a member of. */
  projectIds: string[];
}

/** A normalised project create/update. `name` is required on create. */
export interface ProjectWrite {
  name?: string | undefined;
  identifier?: string | null | undefined;
  description?: string | null | undefined;
  /** Set/clear to group the project under a programme (derived-programme model). */
  programmeId?: string | null | undefined;
  /** The gateway-minted correlation GUID, passed to the backend to store on create (never sent by a
   *  client). See `Project.omniInstanceId`. */
  omniInstanceId?: string | undefined;
  /** The project's lifecycle status (backend-native string). Set/clear to move a project between live
   *  and closed. See `Project.status`. */
  status?: string | null | undefined;
}

export interface Summary {
  projectId: string;
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  completionRate: number;
  overdue: number;
}

export interface HistoryPoint {
  date: string;
  completionRate: number;
  totalIssues: number;
  completedIssues: number;
  openBlockers: number | null;
  provenance: "sourced" | "derived" | "sample";
}

/**
 * A portfolio-level state at a point in time, served by the time-travel replay
 * (read back from the operator's logging server). `replayed` = a real recorded
 * state; `projected` = a model of the future (never fact); `sample` = demo.
 */
export interface HistoryState {
  at: string; // ISO 8601
  completionPct: number;
  openBlockers: number | null;
  provenance: "replayed" | "projected" | "sourced" | "derived" | "sample";
}

export interface Baseline {
  projectId: string;
  name?: string;
  capturedAt: string;
  items: Array<{ issueId: string; title: string; plannedStart: string | null; plannedFinish: string | null }>;
  provenance: "sourced" | "derived" | "sample";
}

export interface PortfolioRow {
  projectId: string;
  projectName: string;
  ragStatus: string;
  scheduleVarianceDays: number;
  budgetVariancePercentage: number;
  activeBlockersCount: number;
}

export interface FxRates {
  base: string;
  rates: Record<string, number>;
  provenance: "sourced" | "sample";
  asOf: string;
}

import type { EnumeratedField } from "../lib/field-registry";

/** Raw capability flags a backend can populate (domain → available). */
export type CapabilityFlags = Record<string, boolean>;

/** Whether a field/entity can be surfaced (read) and stored (written). */
export interface FieldSupport {
  surface: boolean;
  store: boolean;
}

/**
 * Per-field / per-entity support a backend declares. Finer-grained than the
 * domain flags: e.g. a backend may surface `dueDate` read-only (surface without
 * store), or have no `programmeId` field at all (programme entity unsupported).
 */
export interface BackendFieldMap {
  fields: Record<string, FieldSupport>;
  entities: Record<string, FieldSupport>;
}

/** Dry-run verification of the broker contract — must never mutate a backend. */
export interface VerifyReport {
  ok: boolean;
  actions: Array<{ name: string; ok: boolean; status: number; ms: number; note?: string | null }>;
}

/** Normalised error taxonomy — no broker-specific status quirks leak upward. */
export type BrokerErrorCode = "conflict" | "not_found" | "unauthorized" | "bad_request" | "unavailable";

export class BrokerError extends Error {
  readonly code: BrokerErrorCode;
  readonly status: number;
  /** Optional extra payload (e.g. the current row on a `conflict`). */
  readonly details?: unknown;
  constructor(code: BrokerErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "BrokerError";
    this.code = code;
    this.status = STATUS_FOR[code];
    this.details = details;
  }
  /**
   * Map an upstream HTTP status onto the normalised taxonomy with a safe,
   * code-derived client message. The raw upstream body must NOT be passed here
   * (it may carry backend-internal detail); log it server-side instead. An
   * optional `details` payload (e.g. the current row on a conflict) is carried
   * out-of-band for the contract, not in the client-facing message.
   */
  static fromStatus(status: number, details?: unknown): BrokerError {
    if (status === 409) return new BrokerError("conflict", "the item was modified by someone else", details);
    if (status === 404) return new BrokerError("not_found", "the requested resource was not found");
    if (status === 401 || status === 403) return new BrokerError("unauthorized", "the backend rejected the request as unauthorized");
    if (status >= 400 && status < 500) return new BrokerError("bad_request", "the backend rejected the request");
    return new BrokerError("unavailable", "the backend is currently unavailable");
  }
}

const STATUS_FOR: Record<BrokerErrorCode, number> = {
  conflict: 409,
  not_found: 404,
  unauthorized: 401,
  bad_request: 400,
  unavailable: 502,
};

/**
 * A backend's self-describing SCHEMA manifest — the tables, canonical fields and relationships it
 * actually holds, plus which fields are POPULATED (have data). Returned by the optional
 * `describeSchema`. Only a backend that owns its schema can answer this — in practice OmniProject's
 * own stateful self-host database. Ordinary SaaS backends (the stateless-overlay default) do NOT
 * implement it; the gateway then falls back to the static capability flags. The gateway uses it to
 * surface only what a backend genuinely has (superset ∩ manifest).
 */
export interface SchemaManifest {
  /** Canonical entity keys (tables) present, e.g. ["project", "issue", "programme"]. */
  tables: string[];
  /** Canonical field keys present in the schema (a subset of the superset). */
  fields: string[];
  /** Foreign-key/relationship edges between entities. */
  relationships: { from: string; field: string; to: string }[];
  /** Canonical field keys that actually hold data — a subset of `fields`. When given, the gateway
   *  surfaces only these ("populated, not just possible"); when omitted, all `fields` are surfaced. */
  populated?: string[];
}

/**
 * The broker contract. Domain operations only — implementers translate to/from
 * their transport. `kind` and `live` are for diagnostics, not behaviour.
 */
export interface Broker {
  readonly kind: string; // "n8n" | "demo"
  readonly live: boolean; // false for the demo adapter

  // Core
  listProjects(ctx: ActorContext): Promise<Project[]>;
  /** Create a project in the backend system of record (manager+, capability-gated). */
  createProject(ctx: ActorContext, input: ProjectWrite): Promise<Project>;
  /** Update a project — incl. programmeId grouping (manager+, capability-gated). */
  updateProject(ctx: ActorContext, projectId: string, input: ProjectWrite): Promise<Project>;
  /** People on a project with their access level (capability-gated). */
  projectMembers(ctx: ActorContext, projectId: string): Promise<ProjectMember[]>;
  listIssues(ctx: ActorContext, projectId: string): Promise<Issue[]>;
  getIssue(ctx: ActorContext, projectId: string, issueId: string): Promise<Issue | null>;
  writeIssue(ctx: ActorContext, op: "create" | "update" | "delete", input: IssueWrite): Promise<Issue | null>;
  /** A task's child issues/notes (0..many; capability-gated). */
  listTaskItems(ctx: ActorContext, projectId: string, taskId: string): Promise<TaskItem[]>;
  /** Raise a child issue or note against a task (contributor+, capability-gated). */
  createTaskItem(ctx: ActorContext, projectId: string, taskId: string, input: TaskItemWrite): Promise<TaskItem>;
  verify(ctx: ActorContext, opts?: { projectId?: string }): Promise<VerifyReport>;

  // Read-model long tail (explicit methods — no action strings leak upward)
  listActivity(ctx: ActorContext): Promise<Row[]>;
  projectSummary(ctx: ActorContext, projectId: string): Promise<Summary>;
  projectHistory(ctx: ActorContext, projectId: string): Promise<HistoryPoint[]>;
  baseline(ctx: ActorContext, projectId: string): Promise<Baseline | null>;
  listRaid(ctx: ActorContext, projectId: string): Promise<Row[]>;
  addRaid(ctx: ActorContext, projectId: string, input: Record<string, unknown>): Promise<Row>;
  notifications(ctx: ActorContext): Promise<Row[]>;
  portfolioHealth(ctx: ActorContext): Promise<PortfolioRow[]>;
  resourceCapacity(ctx: ActorContext, projectId: string): Promise<Row[]>;
  projectFinancials(ctx: ActorContext, projectId: string): Promise<Row>;
  capabilities(ctx: ActorContext): Promise<CapabilityFlags>;
  /**
   * Optional finer-grained field/entity support. When a broker provides it, it
   * overrides the domain-derived defaults; when omitted, the gateway derives a
   * map from the domain flags. Lets a backend say "storyPoints: yes, dueDate:
   * read-only, no programme grouping" precisely.
   */
  fieldMap?(ctx: ActorContext): Promise<BackendFieldMap | null>;
  /**
   * Optional API enumeration: report the fields this backend exposes, so wiring a
   * new system of record can reconcile them against the canonical registry and
   * flag fields the seam doesn't yet understand. See lib/field-registry.ts.
   */
  describeFields?(ctx: ActorContext): Promise<EnumeratedField[]>;
  /**
   * Optional schema introspection: report the tables/fields/relationships this backend HOLDS and
   * which fields are populated, so the gateway surfaces only what genuinely exists (superset ∩
   * manifest). Only a backend that owns its schema implements it — in practice OmniProject's own
   * stateful self-host DB. Absent on ordinary SaaS backends, where the gateway falls back to the
   * static capability flags. See lib/availability.
   */
  describeSchema?(ctx: ActorContext): Promise<SchemaManifest | null>;
  /**
   * Multi-currency FX rate table, read live (never cached/stored). `opts.asOf`, when given, asks
   * for the rate as of that ISO date — the FX rate-source + as-of-date policy for consolidation
   * (spot / period-close / budget rate; see `FxRatePolicy` in lib/settings). OPTIONAL support: a
   * broker that can't serve a historical rate for an arbitrary past date degrades gracefully to its
   * current live snapshot (the reference and demo brokers do this).
   */
  fxRates(ctx: ActorContext, opts?: { asOf?: string }): Promise<FxRates>;
  /** Time-travel: replay recorded portfolio states from the logging server. */
  replay(ctx: ActorContext, opts: { from?: string; to?: string }): Promise<HistoryState[]>;
  /**
   * OPTIONAL — a cheap, opaque CHANGE TOKEN for a resource (e.g. `"projects"`,
   * `"issues:proj-001"`), used for conditional/delta reads: the gateway compares it
   * to the client's last-seen token and, on a match, returns 304 WITHOUT performing
   * the full read — so the heavy backend call is skipped. Map it to a backend ETag,
   * a max(updatedAt), or a sync cursor. Return null when the resource has no cheap
   * version (the gateway falls back to hashing the full payload). Brokers that don't
   * implement this are unaffected — conditional reads degrade to the payload hash.
   */
  changeToken?(ctx: ActorContext, resource: string): Promise<string | null>;
  /**
   * OPTIONAL — verify the broker can reach a backend with its configured
   * credentials (a "test connection"). Returns `{ ok }`. Brokers that don't
   * implement it report "unsupported" upstream.
   */
  verifyConnection?(ctx: ActorContext, backend: string): Promise<{ ok: boolean; detail?: string }>;
  /**
   * OPTIONAL — delegate a vendor credential to the BROKER's own encrypted credential
   * store (e.g. n8n credentials). The secret is relayed ONCE through the gateway and
   * never persisted here; the broker owns it thereafter. Returns a non-secret
   * reference. Brokers without a vault report "unsupported" so the operator falls
   * back to the env/Docker-secret scaffolding.
   */
  storeCredential?(ctx: ActorContext, input: { backend: string; name: string; value: string }): Promise<{ stored: boolean; ref?: string }>;
}
