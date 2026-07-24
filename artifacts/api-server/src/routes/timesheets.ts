/**
 * Timesheets API — entry + the submit/approve workflow, persisted BELOW the seam via the resolved
 * `TimesheetStore` (self-host DB and/or backend, per docs/PPM-DEPTH.md). The gateway holds nothing: it
 * enforces the authoritative state machine + RBAC, then delegates load/save to the store. When no
 * store is configured every route answers 409 with an honest "not enabled".
 */
import { Router, type Request, type Response } from "express";
import { getSession } from "./auth";
import { hasRole } from "../lib/rbac";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { timesheetStoreFor, describeTimesheetSources, type TimesheetStore } from "../timesheets/store";
import { applyTimesheetAction, TimesheetError, type Timesheet, type TimeEntry, type TimesheetAction, type TimesheetStatus } from "../timesheets/state-machine";

const TIMESHEET_STATUSES: readonly TimesheetStatus[] = ["draft", "submitted", "approved", "rejected"];
const isTimesheetStatus = (v: string): v is TimesheetStatus => (TIMESHEET_STATUSES as readonly string[]).includes(v);

/** Cap entries per sheet — the array is caller-supplied and persisted verbatim, so an unbounded or
 *  malformed one is a write-amplification / bad-data vector. A week of entries is well under this. */
const MAX_TIMESHEET_ENTRIES = 1_000;

/** A structurally-valid time entry: the fields the store + state-machine rely on. Rejects a hostile
 *  or malformed entry (non-finite/negative hours, non-string id/projectId/date) before it is stored. */
function isValidEntry(v: unknown): v is TimeEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e["id"] === "string"
    && typeof e["projectId"] === "string"
    && typeof e["date"] === "string"
    && typeof e["hours"] === "number" && Number.isFinite(e["hours"]) && (e["hours"] as number) >= 0;
}

const router = Router();

/** Resolve the store or answer 409; returns null when unavailable (caller returns). */
function store(_req: Request, res: Response): TimesheetStore | null {
  const s = timesheetStoreFor();
  if (!s) {
    // Honest: enabling timesheets needs a registered store PROVIDER at boot — a connected backend that
    // supports timesheets, or a self-host timesheet store. No provider ships wired by default, so this
    // stays a 409 until one is registered (registerTimesheetStore). See docs/PPM-DEPTH.md.
    res.status(409).json({ error: "Timesheets are not enabled: no timesheet store is configured. Connect a backend that supports timesheets, or register a self-host timesheet store (registerTimesheetStore)." });
    return null;
  }
  return s;
}

function nowIso(): string {
  return new Date().toISOString();
}

// GET /api/timesheets/sources — which below-seam source(s) timesheets route to (for the UI).
router.get("/timesheets/sources", (_req, res) => {
  res.json(describeTimesheetSources());
});

// GET /api/timesheets — the caller's own sheets, or (for an approver) a status-filtered queue.
router.get("/timesheets", async (req, res) => {
  const s = store(req, res);
  if (!s) return;
  const session = getSession(req);
  // Validate the status filter against the known enum instead of casting an arbitrary query string.
  const statusRaw = typeof req.query["status"] === "string" ? (req.query["status"] as string) : undefined;
  const status = statusRaw && isTimesheetStatus(statusRaw) ? statusRaw : undefined;
  // Approvers (manager+) may list across resources; everyone else is scoped to themselves.
  const canApprove = hasRole(req, "manager");
  const filter: { resourceId?: string; status?: Timesheet["status"] } = {
    ...(canApprove ? {} : { resourceId: session?.sub ?? "__none__" }),
    ...(status ? { status } : {}),
  };
  res.json(await s.list(filter));
});

/** The validated draft-upsert body: the required fields, entries already shape-checked. */
interface TimesheetSaveInput { id: string; weekStart: string; entries: TimeEntry[] }

// POST /api/timesheets — upsert a DRAFT sheet for the caller (entry). The owner is always the caller.
// On the Lane 2 spine: parse resolves the store (409) and shape-checks the body (400/413); the async
// `prepare` loads any existing sheet to enforce ownership (403) and the draft-only status guard (409) — a
// check that needs the stored row, so it can't live in the sync parse. Then RBAC (contributor: a write, so a
// read-only viewer token must not) → ruleset → save → audit by construction (the route recorded no audit).
export const timesheetSaveCommand: CommandDescriptor<{ s: TimesheetStore; input: TimesheetSaveInput; sub: string }> = {
  name: "create_timesheet",
  method: "post",
  path: "/timesheets",
  role: "contributor",
  parse: (req, res) => {
    const s = store(req, res);
    if (!s) return null;
    const body = (req.body ?? {}) as Partial<Timesheet>;
    if (!body.id || !body.weekStart || !Array.isArray(body.entries)) {
      res.status(400).json({ error: "id, weekStart and entries are required" });
      return null;
    }
    if (body.entries.length > MAX_TIMESHEET_ENTRIES) {
      res.status(413).json({ error: `Too many entries: ${body.entries.length} exceeds the ${MAX_TIMESHEET_ENTRIES}-entry cap per sheet.` });
      return null;
    }
    if (!body.entries.every(isValidEntry)) {
      res.status(400).json({ error: "each entry needs a string id, projectId and date, and finite non-negative hours" });
      return null;
    }
    return { s, input: { id: body.id, weekStart: body.weekStart, entries: body.entries }, sub: getSession(req)?.sub ?? "__none__" };
  },
  prepare: async (_req, res, args) => {
    const existing = await args.s.get(args.input.id);
    if (existing && existing.resourceId !== args.sub) {
      res.status(403).json({ error: "cannot edit another resource's timesheet" });
      return null;
    }
    if (existing && existing.status !== "draft") {
      res.status(409).json({ error: `cannot edit a ${existing.status} timesheet` });
      return null;
    }
    return args;
  },
  ruleScope: (_req, args) => ({ payload: args.input as unknown as Record<string, unknown> }),
  run: async (_req, _res, args) => {
    const sheet: Timesheet = {
      id: args.input.id,
      resourceId: args.sub,
      weekStart: args.input.weekStart,
      entries: args.input.entries,
      status: "draft",
    };
    await args.s.save(sheet);
    return sheet;
  },
  audit: "create_timesheet",
};
mountCommand(router, timesheetSaveCommand);

type TimesheetActionType = "submit" | "reopen" | "approve" | "reject";
const TIMESHEET_ACTIONS = new Set<TimesheetActionType>(["submit", "reopen", "approve", "reject"]);

// POST /api/timesheets/:id/action — apply a workflow action, enforcing the state machine + RBAC. The
// eligibility depends on the LOADED sheet (the owner may submit/reopen; a manager+ may approve/reject), so
// the load + per-type authorization is the async `prepare`. No blanket role floor — eligibility is per type.
// parse validates the action type (400); run applies the state machine (a TimesheetError → 422 via onError).
// The ruleset runs by construction (a write), and success audits `timesheet.<type>` (the route recorded none).
export const timesheetActionCommand: CommandDescriptor<
  { s: TimesheetStore; sheet: Timesheet; type: TimesheetActionType; sub: string; note?: string },
  { s: TimesheetStore; type: TimesheetActionType; sub: string; note?: string }
> = {
  name: "timesheet_action",
  method: "post",
  path: "/timesheets/:id/action",
  parse: (req, res) => {
    const s = store(req, res);
    if (!s) return null;
    const type = (req.body?.type ?? "") as TimesheetActionType;
    if (!TIMESHEET_ACTIONS.has(type)) {
      res.status(400).json({ error: "type must be one of: submit, approve, reject, reopen" });
      return null;
    }
    return { s, type, sub: getSession(req)?.sub ?? "__none__", ...(typeof req.body?.note === "string" ? { note: req.body.note as string } : {}) };
  },
  prepare: async (req, res, prelim) => {
    const sheet = await prelim.s.get(String(req.params["id"]));
    if (!sheet) { res.status(404).json({ error: "timesheet not found" }); return null; }
    // Submit/reopen are the owner's; approve/reject need a manager+ AND aren't self-serve.
    if (prelim.type === "submit" || prelim.type === "reopen") {
      if (sheet.resourceId !== prelim.sub) { res.status(403).json({ error: "only the owner can submit or reopen their timesheet" }); return null; }
    } else if (!hasRole(req, "manager")) {
      res.status(403).json({ error: "approving a timesheet requires at least the manager role" });
      return null;
    }
    return { ...prelim, sheet };
  },
  run: async (_req, _res, args) => {
    const action: TimesheetAction =
      args.type === "submit" ? { type: "submit", at: nowIso() }
      : args.type === "reopen" ? { type: "reopen" }
      : args.type === "approve" ? { type: "approve", by: args.sub, at: nowIso() }
      : { type: "reject", by: args.sub, at: nowIso(), ...(args.note !== undefined ? { note: args.note } : {}) };
    const next = applyTimesheetAction(args.sheet, action);
    await args.s.save(next);
    return next;
  },
  onError: (res, err) => {
    res.status(err instanceof TimesheetError ? 422 : 500).json({ error: err instanceof Error ? err.message : "action failed" });
  },
  audit: (args) => `timesheet.${args.type}`,
};
mountCommand(router, timesheetActionCommand);

export default router;
