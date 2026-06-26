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
 * n8n is the first (and currently only) implementation; see ./n8n.ts.
 */

/** Loosely-typed record — the normalised row shape the broker exchanges. */
export type Row = Record<string, unknown>;

/**
 * Forwarded actor identity. A write is performed "as" this principal so the
 * backend system of record authorises it under the real user (not a shared
 * admin key). `authHeader` is the transport credential to forward; `token` is
 * the same access token echoed in the per-user context. Demo brokers ignore both.
 */
export interface ActorContext {
  sub?: string;
  email?: string;
  name?: string;
  role?: string;
  token?: string;
  authHeader?: string;
}

/** A normalised project row. */
export interface Project extends Row {
  id: string;
  name: string;
}

/** A normalised issue/work-item row. `version` is the concurrency token. */
export interface Issue extends Row {
  id: string;
  projectId: string;
  title: string;
  status: string;
  version?: number;
}

/** A normalised issue mutation. `expectedVersion` drives optimistic concurrency. */
export interface IssueWrite {
  projectId: string;
  issueId?: string;
  title?: string;
  description?: string | null;
  status?: string;
  priority?: string;
  assignee?: string | null;
  labels?: string[];
  startDate?: string | Date | null;
  dueDate?: string | Date | null;
  expectedVersion?: number;
}

/** A normalised project create/update. `name` is required on create. */
export interface ProjectWrite {
  name?: string;
  identifier?: string | null;
  description?: string | null;
  /** Set/clear to group the project under a programme (derived-programme model). */
  programmeId?: string | null;
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
  listIssues(ctx: ActorContext, projectId: string): Promise<Issue[]>;
  getIssue(ctx: ActorContext, projectId: string, issueId: string): Promise<Issue | null>;
  writeIssue(ctx: ActorContext, op: "create" | "update" | "delete", input: IssueWrite): Promise<Issue | null>;
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
  fxRates(ctx: ActorContext): Promise<FxRates>;
  /** Time-travel: replay recorded portfolio states from the logging server. */
  replay(ctx: ActorContext, opts: { from?: string; to?: string }): Promise<HistoryState[]>;
}
