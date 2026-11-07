// OmniStore backend — the durable, encrypted, tamper-evident system-of-record adapter below the broker
// seam (full contract + rationale in the block comment under the imports).
import { isDone } from "../vocabulary";
import { BrokerHttpError, type BrokerBackend, type ActorCtx } from "../reference-broker-blueprint";
import { OmniEventLog, resolveStoreKey, deriveKeys, type OmniLink } from "../builtin/omnistore-log";
import { omnistoreSupersetCapabilities } from "../../lib/omnistore-homing";
import { inScope, type Scope, type ScopedResource } from "../../lib/scope";

type Row = Record<string, unknown>;

/** A project Row viewed as a `ScopedResource` for the shared scope helpers (owner / member / programme). */
function projectAsScoped(r: Row): ScopedResource {
  return {
    id: r["id"] as string | undefined,
    ownerSub: (r["ownerSub"] as string | null | undefined) ?? undefined,
    memberSubs: r["memberSubs"] as readonly string[] | undefined,
    programmeId: (r["programmeId"] as string | null | undefined) ?? undefined,
    programmeIds: r["programmeIds"] as readonly string[] | undefined,
  };
}

/** Does the caller's forwarded DATA scope permit this project? A SYSTEM/internal caller (no forwarded
 *  scope) is unrestricted; a user/programme/guest caller is bounded to what they own / are a member of /
 *  have a programme grant for. This is the row-level enforcement the seam contract expects a system of
 *  record to apply (`user` = "only resources they own or are a member of"). */
function projectVisible(ctx: ActorCtx, project: Row | undefined): boolean {
  if (!project) return false;
  const scope = ctx.scope as Scope | undefined;
  return !scope || inScope(scope, projectAsScoped(project));
}

/**
 * OmniStore BACKEND — the durable, encrypted, tamper-evident system of record that sits BELOW the
 * broker seam. It implements the neutral `BrokerBackend` contract (Row in, Row out), so ANY broker
 * pointed at the OmniStore container over the wire (BROKER_URL / SQL_SIDECAR_URL) uses it — OmniStore
 * is a backend, not a broker.
 *
 * SUPERSET storage: every write persists the WHOLE input Row — the full canonical model PLUS any
 * extension/key fields third-party vendor APIs can't hold (correlation GUIDs, programme memberships,
 * custom fields, relinks). Nothing is allow-listed away; reads return exactly what was stored.
 *
 * State is a deterministic projection of the append-only, hash-chained, encrypted event log
 * (omnistore-log) — so it is provably immutable except via valid calls, encrypted at rest, and
 * portable between instances. See docs/design/STATEFUL-SIDECAR.md.
 */

interface State {
  projects: Map<string, Row>;
  issues: Map<string, Row[]>; // projectId → issues
  raid: Map<string, Row[]>;
  taskItems: Map<string, Row[]>; // taskId → items
  comments: Map<string, Row[]>; // issueId → comment thread (newest last)
  attachments: Map<string, Row[]>; // issueId → attachment REFERENCES (never bytes)
  seq: { project: number; issue: number; raid: number; item: number; comment: number; attachment: number };
}
const empty = (): State => ({ projects: new Map(), issues: new Map(), raid: new Map(), taskItems: new Map(), comments: new Map(), attachments: new Map(), seq: { project: 0, issue: 0, raid: 0, item: 0, comment: 0, attachment: 0 } });

const idNum = (id: unknown): number => { const m = /(\d+)$/.exec(String(id)); return m ? Number(m[1]) : 0; };

function recount(state: State, projectId: string): void {
  const p = state.projects.get(projectId);
  if (!p) return;
  const list = state.issues.get(projectId) ?? [];
  p["issueCount"] = list.length;
  p["completedCount"] = list.filter((i) => isDone(String(i["status"]))).length;
}

/** The reducer — apply one log link to the Row state. Shared by live writes and full replay, so a
 *  reload can never diverge from a live write. Deterministic (reads only values already in the event). */
export function applyEvent(state: State, link: OmniLink): void {
  const p = link.payload;
  const row = (k: string) => p[k] as Row;
  switch (link.action) {
    case "project.create": {
      const r = { ...row("row") };
      state.projects.set(String(r["id"]), r);
      if (!state.issues.has(String(r["id"]))) state.issues.set(String(r["id"]), []);
      state.seq.project = Math.max(state.seq.project, idNum(r["id"]));
      return;
    }
    case "project.update": {
      const proj = state.projects.get(p["id"] as string);
      if (proj) Object.assign(proj, row("patch"), { updatedAt: link.ts });
      return;
    }
    case "issue.create": {
      const r = { ...row("row") };
      (state.issues.get(String(r["projectId"])) ?? state.issues.set(String(r["projectId"]), []).get(String(r["projectId"]))!)!.push(r);
      state.seq.issue = Math.max(state.seq.issue, idNum(r["id"]));
      recount(state, String(r["projectId"]));
      return;
    }
    case "issue.update": {
      const list = state.issues.get(p["projectId"] as string) ?? [];
      const issue = list.find((x) => x["id"] === p["issueId"]);
      if (issue) Object.assign(issue, row("patch"), { updatedAt: link.ts });
      recount(state, p["projectId"] as string);
      return;
    }
    case "issue.delete": {
      const list = state.issues.get(p["projectId"] as string) ?? [];
      const idx = list.findIndex((x) => x["id"] === p["issueId"]);
      if (idx !== -1) list.splice(idx, 1);
      recount(state, p["projectId"] as string);
      return;
    }
    case "raid.add": {
      const r = { ...row("row") };
      (state.raid.get(String(r["projectId"])) ?? state.raid.set(String(r["projectId"]), []).get(String(r["projectId"]))!)!.push(r);
      state.seq.raid = Math.max(state.seq.raid, idNum(r["id"]));
      return;
    }
    case "taskItem.add": {
      const r = { ...row("row") };
      (state.taskItems.get(String(r["taskId"])) ?? state.taskItems.set(String(r["taskId"]), []).get(String(r["taskId"]))!)!.push(r);
      state.seq.item = Math.max(state.seq.item, idNum(r["id"]));
      return;
    }
    case "comment.add": {
      const r = { ...row("row") };
      (state.comments.get(String(r["issueId"])) ?? state.comments.set(String(r["issueId"]), []).get(String(r["issueId"]))!)!.push(r);
      state.seq.comment = Math.max(state.seq.comment, idNum(r["id"]));
      return;
    }
    case "attachment.add": {
      const r = { ...row("row") };
      (state.attachments.get(String(r["issueId"])) ?? state.attachments.set(String(r["issueId"]), []).get(String(r["issueId"]))!)!.push(r);
      state.seq.attachment = Math.max(state.seq.attachment, idNum(r["id"]));
      return;
    }
  }
}

// OmniStore is the SoR-of-last-resort SUPERSET store — it persists the WHOLE row for any vendor shape, so
// every capability domain it homes is one it can honestly serve (roll-ups it doesn't compute still return
// honest empties below; the raw fields round-trip, which the domain flag gates). Sole backend ⇒ 100%.
const CAPABILITIES: Record<string, boolean> = omnistoreSupersetCapabilities();

/** Build an OmniStore `BrokerBackend` over the encrypted log engine. `onCommit` persists the sealed
 *  log after each write (durability); omit for ephemeral/in-memory. */
export function omniStoreBackend(log: OmniEventLog, onCommit?: (sealed: string) => void): BrokerBackend {
  const state = empty();
  for (const link of log.entries()) applyEvent(state, link);

  const commit = (action: string, payload: Row): OmniLink => {
    const link = log.append(action, null, payload, new Date().toISOString());
    applyEvent(state, link);
    onCommit?.(log.sealed());
    return link;
  };
  const now = () => new Date().toISOString();

  // The project a given issue belongs to (comments/attachments are keyed by issueId only, so scope
  // enforcement on them has to resolve the owning project first).
  const projectOfIssue = (issueId: string): Row | undefined => {
    for (const [pid, list] of state.issues) if (list.some((i) => i["id"] === issueId)) return state.projects.get(pid);
    return undefined;
  };
  // A READ gate: the project row iff the caller may see it, else null → the read returns its empty form and
  // never leaks another tenant's data. Absent project ⇒ null too (unchanged empty result).
  const readable = (ctx: ActorCtx, projectId: string): Row | null => {
    const proj = state.projects.get(projectId);
    return proj && projectVisible(ctx, proj) ? proj : null;
  };
  // A WRITE gate: refuse (403) an out-of-scope target. Absent project is left to the method's own 404/create
  // semantics (a create for a brand-new id is the caller's own project once stamped with ownerSub).
  const assertWritable = (ctx: ActorCtx, projectId: string): void => {
    const proj = state.projects.get(projectId);
    if (proj && !projectVisible(ctx, proj)) throw new BrokerHttpError(403, { message: "project out of scope" });
  };

  return {
    // ── Reads (scope-enforced: a caller sees only projects they own / are a member of / have a grant for) ──
    async listProjects(ctx) { return [...state.projects.values()].filter((r) => projectVisible(ctx, r)).map((r) => ({ ...r })); },
    async listIssues(ctx, projectId) { return readable(ctx, projectId) ? (state.issues.get(projectId) ?? []).map((r) => ({ ...r })) : []; },
    async getIssue(ctx, projectId, issueId) { return readable(ctx, projectId) ? (state.issues.get(projectId) ?? []).find((i) => i["id"] === issueId) ?? null : null; },
    async listProjectMembers() { return []; },
    async listTaskItems(_ctx, _projectId, taskId) { return (state.taskItems.get(taskId) ?? []).map((r) => ({ ...r })); },
    async projectSummary(ctx, projectId) {
      if (!readable(ctx, projectId)) return { projectId, total: 0, completed: 0, overdue: 0, byStatus: {}, completionPct: 0 };
      const issues = state.issues.get(projectId) ?? [];
      const completed = issues.filter((i) => isDone(String(i["status"]))).length;
      return { projectId, total: issues.length, completed, overdue: 0, byStatus: {}, completionPct: issues.length ? Math.round((completed / issues.length) * 100) : 0 };
    },
    // Domains a Phase-1 store doesn't model separately return honest empties (capability-honest) — but
    // any such FIELDS written onto a project/issue are preserved in its stored Row (the superset).
    async projectHistory() { return []; },
    async baseline() { return null; },
    async raid(ctx, projectId) { return readable(ctx, projectId) ? (state.raid.get(projectId) ?? []).map((r) => ({ ...r })) : []; },
    async portfolioHealth(ctx) {
      return [...state.projects.values()].filter((proj) => projectVisible(ctx, proj)).map((proj) => {
        const issues = state.issues.get(String(proj["id"])) ?? [];
        const completed = issues.filter((i) => isDone(String(i["status"]))).length;
        return { projectId: proj["id"], name: proj["name"], total: issues.length, completed, rag: "green" };
      });
    },
    async resourceCapacity() { return []; },
    async projectFinancials(_ctx, projectId) { return { projectId, currency: "GBP", budget: null, actualCost: null, earnedValue: null, committed: null }; },
    async notifications() { return []; },
    async capabilities() { return { ...CAPABILITIES }; },
    async fxRates() { return { base: "GBP", rates: { GBP: 1, USD: 1.27, EUR: 1.17 } }; },
    async replay() { return []; },
    async activity() { return []; },

    // ── Writes (store the WHOLE Row — superset) ──────────────────────────────
    async createProject(ctx, input) {
      const id = `proj-${state.seq.project + 1}`;
      // Stamp ownership so the creator (and anyone in memberSubs) can see it under user-level scope. `input`
      // may pre-set ownerSub/memberSubs (e.g. an admin creating on someone's behalf); default owner = creator.
      const row: Row = { ...input, id, ownerSub: input["ownerSub"] ?? ctx.sub ?? null, source: "omnistore", issueCount: 0, completedCount: 0, createdAt: now(), updatedAt: now() };
      commit("project.create", { row });
      return { ...row };
    },
    async updateProject(ctx, projectId, input) {
      if (!state.projects.has(projectId)) throw new BrokerHttpError(404);
      assertWritable(ctx, projectId);
      commit("project.update", { id: projectId, patch: { ...input } });
      return { ...state.projects.get(projectId)! };
    },
    async createIssue(ctx, projectId, input) {
      assertWritable(ctx, projectId);
      const id = `iss-${state.seq.issue + 1}`;
      const row: Row = { ...input, id, projectId, status: input["status"] ?? "todo", version: 1, source: "omnistore", createdAt: now(), updatedAt: now() };
      commit("issue.create", { row });
      return { ...row };
    },
    async updateIssue(ctx, projectId, issueId, input) {
      assertWritable(ctx, projectId);
      const issue = (state.issues.get(projectId) ?? []).find((i) => i["id"] === issueId);
      if (!issue) throw new BrokerHttpError(404);
      const current = (issue["version"] as number) ?? 1;
      const expected = input["expectedVersion"];
      if (expected != null && expected !== current) throw new BrokerHttpError(409, { ...issue }); // current row for the gateway
      const { projectId: _p, issueId: _i, expectedVersion: _v, ...patch } = input;
      commit("issue.update", { projectId, issueId, patch: { ...patch, version: current + 1 } });
      return { ...(state.issues.get(projectId) ?? []).find((i) => i["id"] === issueId)! };
    },
    async deleteIssue(ctx, projectId, issueId) {
      assertWritable(ctx, projectId);
      commit("issue.delete", { projectId, issueId });
      return null;
    },
    async createRaidEntry(ctx, projectId, input) {
      assertWritable(ctx, projectId);
      const id = `raid-${state.seq.raid + 1}`;
      const row: Row = { ...input, id, projectId, provenance: "sourced", createdAt: now(), updatedAt: now() };
      commit("raid.add", { row });
      return { ...row };
    },
    async createTaskItem(_ctx, _projectId, taskId, input) {
      const id = `ti-${state.seq.item + 1}`;
      const row: Row = { kind: "note", content: "", ...input, id, taskId, createdAt: now() };
      commit("taskItem.add", { row });
      return { ...row };
    },

    // ── Comments (Jira-class first-class collaboration entity) ────────────────
    // Kept as their OWN event-sourced thread keyed by issueId — not folded into an issue Row — so the
    // thread is append-only, individually addressable, and survives replay like every other entity.
    async listTaskComments(ctx, issueId) {
      const proj = projectOfIssue(issueId);
      if (proj && !projectVisible(ctx, proj)) return [];
      return (state.comments.get(issueId) ?? []).map((r) => ({ ...r }));
    },
    async addTaskComment(ctx, issueId, input) {
      const proj = projectOfIssue(issueId);
      if (proj && !projectVisible(ctx, proj)) throw new BrokerHttpError(403, { message: "issue out of scope" });
      const id = `cmt-${state.seq.comment + 1}`;
      // Store the WHOLE input Row (superset), then stamp the fields the store owns. `author` defaults to
      // the forwarded actor so a comment is attributable even when the caller doesn't supply one.
      const row: Row = { ...input, id, issueId, author: input["author"] ?? ctx.sub ?? null, createdAt: now() };
      commit("comment.add", { row });
      return { ...row };
    },

    // ── Attachments (Jira-class, REFERENCES only — zero-at-rest) ──────────────
    // OmniStore stores a POINTER to where the file lives (filename/url/contentType/size), never the
    // bytes. `filename` is required; any raw content is dropped so the encrypted log can't become a blob
    // store — the zero-at-rest guarantee holds even for a first-party backend.
    async listTaskAttachments(ctx, issueId) {
      const proj = projectOfIssue(issueId);
      if (proj && !projectVisible(ctx, proj)) return [];
      return (state.attachments.get(issueId) ?? []).map((r) => ({ ...r }));
    },
    async addTaskAttachment(ctx, issueId, input) {
      const proj = projectOfIssue(issueId);
      if (proj && !projectVisible(ctx, proj)) throw new BrokerHttpError(403, { message: "issue out of scope" });
      const filename = String(input["filename"] ?? "").trim();
      if (!filename) throw new BrokerHttpError(400, { message: "addTaskAttachment requires a filename" });
      const id = `att-${state.seq.attachment + 1}`;
      // Reference fields ONLY — never persist bytes/data even if a caller sends them.
      const { data: _data, bytes: _bytes, content: _content, ...ref } = input;
      const row: Row = {
        ...ref, id, issueId, filename,
        url: input["url"] ?? null, contentType: input["contentType"] ?? null, size: input["size"] ?? null,
        addedBy: input["addedBy"] ?? ctx.sub ?? null, addedAt: now(),
      };
      commit("attachment.add", { row });
      return { ...row };
    },
  };
}

/** Build an OmniStore backend from an optional sealed blob (decrypt + verify on load; fail-closed) and
 *  an optional persistence hook. Fresh when no blob is given. */
export function loadOmniStoreBackend(sealed: string | null, onCommit?: (sealed: string) => void, root: Buffer = resolveStoreKey()): BrokerBackend {
  const keys = deriveKeys(root);
  const log = sealed ? OmniEventLog.openSealed(sealed, keys) : new OmniEventLog(keys);
  return omniStoreBackend(log, onCommit);
}
