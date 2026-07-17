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
import type { DocBlock, CanvasElement, Annotation, Deliverable, ProofDecision } from "@workspace/backend-catalogue";

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

/**
 * A TASK — an ACTIONABLE next-action (GTD), distinct from an Issue (a problem/blocker from a helpdesk
 * or project). A task may belong to a project, or stand alone (a personal/portfolio next-action). Its
 * `status` is a GTD state (see broker/vocabulary `CANONICAL_TASK_STATUS`).
 */
export interface Task extends Row {
  id: string;
  title: string;
  /** GTD status (backend-native string; classified by `normaliseTaskStatus`/`isActionable`). */
  status: string;
  /** The project this task advances, or null for a standalone next-action. */
  projectId?: string | null;
  /** GTD context (@calls, @computer, @errands, …) — where/how the action can be done. */
  context?: string | null;
  /** For a `waiting` task: who/what it's waiting on. */
  waitingOn?: string | null;
  /** Who owns the next action (a person). */
  assignee?: string | null;
  // ── Common fields across leading task apps (Todoist / Asana / Things / Linear / ClickUp / To Do) ──
  /** Free-text notes / description. */
  description?: string | null;
  /** Importance — reuses the canonical priority (none/low/medium/high/urgent). */
  priority?: string | null;
  /** Metadata tags/labels for filtering + grouping. */
  tags?: string[];
  /** When the action becomes available (GTD defer / start date, ISO 8601). */
  startDate?: string | null;
  /** Due date (ISO 8601). */
  dueDate?: string | null;
  /** Recurrence rule (e.g. "every weekday", an RRULE) — null for a one-off. */
  recurrence?: string | null;
  /** Estimated effort in hours. */
  estimateHours?: number | null;
  /** Parent task, for subtasks/checklists. */
  parentTaskId?: string | null;
  /** External link (a doc, ticket, PR). */
  url?: string | null;
  /** When it was completed (ISO 8601), if done. */
  completedAt?: string | null;
  // ── Best-of-breed task-app fields (Todoist / MS To Do / Asana / ClickUp / Things) ──
  /** A notify-me time, distinct from the due date (ISO 8601). */
  reminderAt?: string | null;
  /** GTD energy/effort level (low/medium/high) — orthogonal to the hour estimate. */
  energy?: string | null;
  /** Section/list this task groups under within its project (Asana section, Todoist section, ClickUp list). */
  section?: string | null;
  /** Manual sort position within a list/section (Todoist order, Google Tasks position). */
  sortOrder?: number | null;
  /** Followers/collaborators kept in the loop (people), beyond the single assignee. */
  collaborators?: string[];
}

/** A normalised task create/update. `title` is required on create. */
export interface TaskWrite {
  title?: string | undefined;
  status?: string | undefined;
  projectId?: string | null | undefined;
  context?: string | null | undefined;
  waitingOn?: string | null | undefined;
  assignee?: string | null | undefined;
  description?: string | null | undefined;
  priority?: string | null | undefined;
  tags?: string[] | undefined;
  startDate?: string | null | undefined;
  dueDate?: string | null | undefined;
  recurrence?: string | null | undefined;
  estimateHours?: number | null | undefined;
  parentTaskId?: string | null | undefined;
  url?: string | null | undefined;
  completedAt?: string | null | undefined;
  reminderAt?: string | null | undefined;
  energy?: string | null | undefined;
  section?: string | null | undefined;
  sortOrder?: number | null | undefined;
  collaborators?: string[] | undefined;
}

/** A comment on a task (a discussion note). */
export interface TaskComment extends Row {
  id: string;
  taskId: string;
  body: string;
  author?: string | null;
  createdAt: string;
}
export interface TaskCommentWrite {
  body: string;
}

/**
 * A file ATTACHED to a task — a REFERENCE to a file that lives in the backend / an external store, not
 * the bytes (OmniProject is zero-at-rest). Only backends that support attachments expose these.
 */
export interface TaskAttachment extends Row {
  id: string;
  taskId: string;
  filename: string;
  /** Where the file actually lives (a backend/download URL). */
  url?: string | null;
  contentType?: string | null;
  /** Size in bytes, if the backend reports it. */
  size?: number | null;
  addedBy?: string | null;
  addedAt: string;
}
export interface TaskAttachmentWrite {
  filename: string;
  url?: string | null | undefined;
  contentType?: string | null | undefined;
  size?: number | null | undefined;
}

/**
 * A WIKI SPACE — a named container for documents (a knowledge base / team space). Like everything else the
 * body lives in the backend system of record; OmniProject is zero-at-rest. Only backends that model a
 * wiki/knowledge base expose these.
 */
export interface WikiSpace extends Row {
  id: string;
  /** Short stable key (URL segment). */
  key: string;
  name: string;
  description?: string | null;
}

/**
 * A WIKI DOCUMENT — a page in a space, built of primitive `DocBlock`s (see backend-catalogue). Nesting is by
 * `parentId` (a page tree); `slug` is the URL segment within the space. Content is authored in OmniProject
 * but STORED through the broker, so it inherits the data seam's residency and audit controls.
 */
export interface WikiDoc extends Row {
  id: string;
  spaceId: string;
  parentId?: string | null;
  slug: string;
  title: string;
  blocks: DocBlock[];
  updatedAt: string;
  updatedBy?: string | null;
}
export interface WikiDocWrite {
  spaceId: string;
  parentId?: string | null | undefined;
  slug?: string | undefined;
  title: string;
  blocks: DocBlock[];
}

/**
 * A saved REVISION of a wiki document — a point-in-time snapshot captured by the system of record on each
 * write, so a page's history is auditable and any prior state can be restored (by re-saving its content
 * through the normal update path). `versionId` is unique within the document's history.
 */
export interface WikiDocVersion extends Row {
  versionId: string;
  docId: string;
  at: string;               // ISO 8601 — when this revision was saved
  author?: string | null;   // who saved it
  title: string;
  blocks: DocBlock[];
}
/** A revision's metadata (no block body) — the history list view. */
export interface WikiDocVersionMeta {
  versionId: string;
  docId: string;
  at: string;
  author?: string | null;
  title: string;
}

/**
 * A WHITEBOARD — a freeform visual canvas (roadmap 2.3). The drawing is an opaque scene of vector
 * elements; like a wiki page it is authored in OmniProject but STORED through the broker (zero-at-rest),
 * so it inherits the data seam's residency + audit. `scene` is a bounded, sanitised JSON payload (no
 * embedded image data, links restricted to safe schemes) — never executed, just persisted + rendered.
 */
export interface WhiteboardScene {
  /** The canvas elements — typed `canvas`-family primitives (sticky/shape/text/connector/frame), validated
   *  per-type at the gateway. Built of shared primitives, not an opaque third-party scene blob. */
  elements: CanvasElement[];
  /** A minimal, sanitised view state (e.g. background colour) — never a full editor appState. */
  appState?: Record<string, unknown>;
}
/** Where a board lives: `org` = shared org-wide (any viewer+); `user` = personal to its owner only. */
export type WhiteboardVisibility = "org" | "user";

export interface Whiteboard extends Row {
  id: string;
  name: string;
  /** Optional owning project (a board raised against a project); null for an org-level board. */
  projectId?: string | null;
  /** The board's creator (a user `sub`) — the owner for a personal board. Set server-side, never trusted
   *  from the client. */
  ownerSub?: string | null;
  /** Org-wide vs personal. A `user` board is visible/editable only to its `ownerSub`. Defaults to `org`.
   *  (Used by the sidecar store; the encrypted-JSON stores encode location in `storage`/the id instead.) */
  visibility?: WhiteboardVisibility;
  /** Where the board lives: user / project / org (encrypted-JSON areas) or sidecar (the built-in SoR). The
   *  id also encodes this; the field is a convenience for the client. */
  storage?: "user" | "project" | "org" | "sidecar";
  scene: WhiteboardScene;
  updatedAt: string;
  updatedBy?: string | null;
}
export interface WhiteboardWrite {
  name: string;
  projectId?: string | null | undefined;
  /** Requested visibility (org-wide vs personal). The OWNER is set server-side from the caller, never here. */
  visibility?: WhiteboardVisibility | undefined;
  scene: WhiteboardScene;
}
/** A board's metadata (no scene body) — the list view. */
export interface WhiteboardMeta {
  id: string;
  name: string;
  projectId?: string | null;
  ownerSub?: string | null;
  visibility?: WhiteboardVisibility;
  storage?: "user" | "project" | "org" | "sidecar";
  updatedAt: string;
  updatedBy?: string | null;
}

/**
 * A PROOF — a deliverable (image/PDF, referenced not inlined) under creative review (roadmap 2.4). Carries a
 * list of typed `annotation`-family primitives pinned onto it and a review decision bound to the current
 * version. Held in the encrypted-JSON store (storage-target model), like a whiteboard.
 */
export interface Proof extends Row {
  id: string;
  name: string;
  projectId?: string | null;
  ownerSub?: string | null;
  /** Where the proof lives: user / project / org (encrypted-JSON) — the id also encodes this. */
  storage?: "user" | "project" | "org";
  /** The deliverable under review — a safe-scheme reference (zero-at-rest). */
  deliverable: Deliverable;
  /** Bumps when the deliverable is replaced; a review decision is bound to the version it was made against. */
  version: number;
  annotations: Annotation[];
  /** The current review decision, and who/when — stamped server-side, never from the client. */
  decision: ProofDecision;
  decisionVersion?: number;
  decidedBy?: string | null;
  decidedAt?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
}
/** A proof write (create/update) — the sanitised, client-supplied fields (decision is set via its own route). */
export interface ProofWrite {
  name: string;
  projectId?: string | null | undefined;
  deliverable: Deliverable;
  annotations: Annotation[];
}
/** A proof's metadata (no annotations/deliverable body) — the list view. */
export interface ProofMeta {
  id: string;
  name: string;
  projectId?: string | null;
  ownerSub?: string | null;
  storage?: "user" | "project" | "org";
  version: number;
  decision: ProofDecision;
  updatedAt: string;
  updatedBy?: string | null;
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
export type BrokerErrorCode = "conflict" | "not_found" | "unauthorized" | "bad_request" | "rate_limited" | "unavailable";

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
    if (status === 429) return new BrokerError("rate_limited", "the backend is rate-limiting requests; retry shortly");
    if (status >= 400 && status < 500) return new BrokerError("bad_request", "the backend rejected the request");
    return new BrokerError("unavailable", "the backend is currently unavailable");
  }
}

const STATUS_FOR: Record<BrokerErrorCode, number> = {
  conflict: 409,
  not_found: 404,
  unauthorized: 401,
  bad_request: 400,
  rate_limited: 429,
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

// ── Native handoff (companion-app bridge) — see docs/NATIVE-HANDOFF.md ──────────────────────────────────────
/** An artifact kind OmniProject renders inline and a backend can front NATIVELY (Miro, Notion, …). Matches
 *  our primitive/artifact kinds so the SPA can offer "Use native" on the right surfaces. */
export type NativeSurfaceKind =
  | "whiteboard" | "document" | "diagram" | "sheet" | "board"
  | "schedule" | "dashboard" | "report" | "form" | "wiki";

/** What a connected backend advertises it can do natively for a given artifact kind. Pure metadata — no
 *  secrets, no URLs (URLs are minted per-request by `nativeHandoff`, host-allowlisted server-side). */
export interface NativeSurface {
  kind: NativeSurfaceKind;
  vendor: string;                 // catalogue vendor id, e.g. "miro", "notion", "smartsheet"
  label: string;                  // "Open in Miro"
  actions: Array<"open" | "create" | "embed">;
  /** How the artifact comes back: "reference" (a bare link; always available, zero-at-rest),
   *  "content" (pull data via the vendor API), or "screenshot" (capture + AI vision). */
  importMode: "reference" | "content" | "screenshot";
}

/** Anchor: WHAT OmniProject entity the native surface is bound to, so a reimport attaches back. */
export interface NativeContextRef {
  projectId?: string;
  issueId?: string;
  entity?: string;
  id?: string;
}

export interface NativeHandoffRequest {
  kind: NativeSurfaceKind;
  vendor: string;
  action: "open" | "create" | "embed";
  contextRef?: NativeContextRef;
  externalRef?: string;           // for "open": deep-link to an artifact from a prior import
}

/** The vetted, connector-minted handoff. `url` is built by the connector against the vendor's REAL domain
 *  (host-allowlisted) — never from user input. `embedUrl` is the vendor's sandboxed Live-Embed, if any. */
export interface NativeHandoff {
  url: string;
  embedUrl?: string;
  handoffId: string;
}

export interface NativeImportRequest {
  kind: NativeSurfaceKind;
  vendor: string;
  handoffId?: string;             // correlate a just-completed handoff…
  externalRef?: string;           // …or import a known external artifact by id/url
  target: { projectId: string; issueId?: string };
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

  // ── Tasks (GTD actionable next-actions) — OPTIONAL, so a backend that doesn't model tasks simply
  //    omits them (the gateway degrades to an empty task list). Distinct from issues.
  /** Actionable tasks, optionally scoped to a project. */
  listTasks?(ctx: ActorContext, opts?: { projectId?: string }): Promise<Task[]>;
  getTask?(ctx: ActorContext, taskId: string): Promise<Task | null>;
  createTask?(ctx: ActorContext, input: TaskWrite): Promise<Task>;
  updateTask?(ctx: ActorContext, taskId: string, input: TaskWrite): Promise<Task>;
  /** Task comments — a discussion thread on a task. */
  listTaskComments?(ctx: ActorContext, taskId: string): Promise<TaskComment[]>;
  addTaskComment?(ctx: ActorContext, taskId: string, input: TaskCommentWrite): Promise<TaskComment>;
  /** Task attachments — file REFERENCES, only when the backend supports them (capability-gated). */
  listTaskAttachments?(ctx: ActorContext, taskId: string): Promise<TaskAttachment[]>;
  addTaskAttachment?(ctx: ActorContext, taskId: string, input: TaskAttachmentWrite): Promise<TaskAttachment>;

  // ── Wiki / collaborative docs — OPTIONAL, so a backend that doesn't model a knowledge base simply omits
  //    them (the routes answer 501). Bodies live here, in the system of record — zero-at-rest.
  /** The wiki spaces (knowledge bases / team spaces). */
  listWikiSpaces?(ctx: ActorContext): Promise<WikiSpace[]>;
  /** Documents, optionally scoped to one space. */
  listWikiDocs?(ctx: ActorContext, opts?: { spaceId?: string }): Promise<WikiDoc[]>;
  /** One document by id (with its blocks), or null. */
  getWikiDoc?(ctx: ActorContext, id: string): Promise<WikiDoc | null>;
  /** Create / update / delete a document (contributor+, capability-gated). Returns the doc (null on delete). */
  writeWikiDoc?(ctx: ActorContext, op: "create" | "update" | "delete", input: WikiDocWrite & { id?: string }): Promise<WikiDoc | null>;
  /** A document's saved revisions, newest first (metadata only) — the version history. Optional: a backend
   *  that doesn't retain revisions omits it and the history route answers 501. */
  listWikiDocVersions?(ctx: ActorContext, docId: string): Promise<WikiDocVersionMeta[]>;
  /** One saved revision with its blocks (for preview / diff / restore), or null. */
  getWikiDocVersion?(ctx: ActorContext, docId: string, versionId: string): Promise<WikiDocVersion | null>;

  // ── Whiteboards / visual canvas — OPTIONAL (the routes answer 501 when absent). Scenes live here, in
  //    the system of record — zero-at-rest, like the wiki.
  /** The whiteboards, optionally scoped to one project (scene bodies omitted in the list). */
  listWhiteboards?(ctx: ActorContext, opts?: { projectId?: string }): Promise<Whiteboard[]>;
  /** One whiteboard by id (with its scene), or null. */
  getWhiteboard?(ctx: ActorContext, id: string): Promise<Whiteboard | null>;
  /** Create / update / delete a whiteboard (contributor+, capability-gated). Returns the board (null on delete). */
  writeWhiteboard?(ctx: ActorContext, op: "create" | "update" | "delete", input: WhiteboardWrite & { id?: string }): Promise<Whiteboard | null>;

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

  // ── Native handoff (companion-app bridge) — OPTIONAL. A connector implements only what it fronts; the
  //    routes answer 501/empty when absent. See docs/NATIVE-HANDOFF.md. A NEW capability, not a new boundary:
  //    handoff URLs are connector-minted + host-allowlisted; the reimport is a normal broker read/write.
  /** The native surfaces this backend fronts (unioned across connected backends, capability-gating the SPA's
   *  "Use native" affordance). */
  nativeSurfaces?(ctx: ActorContext): Promise<NativeSurface[]>;
  /** Mint the vetted vendor handoff URL — built against the vendor's real domain (host-allowlisted); the user
   *  opens it in THEIR OWN browser and authenticates to the vendor directly (we never wrap its auth screen). */
  nativeHandoff?(ctx: ActorContext, req: NativeHandoffRequest): Promise<NativeHandoff>;
  /** Bring the native artifact back THROUGH the broker: a reference (importMode "reference") or enriched
   *  content. Returns the attachment written to `target`; sanitised + provenance-stamped + audited. */
  nativeImport?(ctx: ActorContext, req: NativeImportRequest): Promise<TaskAttachment>;
}
