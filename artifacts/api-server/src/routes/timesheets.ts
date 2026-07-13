/**
 * Timesheets API — entry + the submit/approve workflow, persisted BELOW the seam via the resolved
 * `TimesheetStore` (self-host DB and/or backend, per docs/PPM-DEPTH.md). The gateway holds nothing: it
 * enforces the authoritative state machine + RBAC, then delegates load/save to the store. When no
 * store is configured every route answers 409 with an honest "not enabled".
 */
import { Router, type Request, type Response } from "express";
import { getSession } from "./auth";
import { hasRole, requireRole } from "../lib/rbac";
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
function store(req: Request, res: Response): TimesheetStore | null {
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

// POST /api/timesheets — upsert a DRAFT sheet for the caller (entry). The owner is always the caller.
// Gate at contributor: writing a timesheet is a write, so a read-only API token (viewer) must not.
router.post("/timesheets", requireRole("contributor"), async (req, res) => {
  const s = store(req, res);
  if (!s) return;
  const session = getSession(req);
  const body = (req.body ?? {}) as Partial<Timesheet>;
  if (!body.id || !body.weekStart || !Array.isArray(body.entries)) {
    res.status(400).json({ error: "id, weekStart and entries are required" });
    return;
  }
  if (body.entries.length > MAX_TIMESHEET_ENTRIES) {
    res.status(413).json({ error: `Too many entries: ${body.entries.length} exceeds the ${MAX_TIMESHEET_ENTRIES}-entry cap per sheet.` });
    return;
  }
  if (!body.entries.every(isValidEntry)) {
    res.status(400).json({ error: "each entry needs a string id, projectId and date, and finite non-negative hours" });
    return;
  }
  const existing = await s.get(body.id);
  if (existing && existing.resourceId !== session?.sub) {
    res.status(403).json({ error: "cannot edit another resource's timesheet" });
    return;
  }
  if (existing && existing.status !== "draft") {
    res.status(409).json({ error: `cannot edit a ${existing.status} timesheet` });
    return;
  }
  const sheet: Timesheet = {
    id: body.id,
    resourceId: session?.sub ?? "__none__",
    weekStart: body.weekStart,
    entries: body.entries,
    status: "draft",
  };
  await s.save(sheet);
  res.json(sheet);
});

// POST /api/timesheets/:id/action — apply a workflow action, enforcing the state machine + RBAC.
router.post("/timesheets/:id/action", async (req, res) => {
  const s = store(req, res);
  if (!s) return;
  const session = getSession(req);
  const sub = session?.sub ?? "__none__";
  const sheet = await s.get(String(req.params["id"]));
  if (!sheet) {
    res.status(404).json({ error: "timesheet not found" });
    return;
  }
  const type = (req.body?.type ?? "") as TimesheetAction["type"];
  // Submit/reopen are the owner's; approve/reject need a manager+ AND aren't self-serve.
  if (type === "submit" || type === "reopen") {
    if (sheet.resourceId !== sub) {
      res.status(403).json({ error: "only the owner can submit or reopen their timesheet" });
      return;
    }
  } else if (type === "approve" || type === "reject") {
    if (!hasRole(req, "manager")) {
      res.status(403).json({ error: "approving a timesheet requires at least the manager role" });
      return;
    }
  } else {
    res.status(400).json({ error: "type must be one of: submit, approve, reject, reopen" });
    return;
  }

  const action: TimesheetAction =
    type === "submit" ? { type: "submit", at: nowIso() }
    : type === "reopen" ? { type: "reopen" }
    : type === "approve" ? { type: "approve", by: sub, at: nowIso() }
    : { type: "reject", by: sub, at: nowIso(), ...(typeof req.body?.note === "string" ? { note: req.body.note } : {}) };

  try {
    const next = applyTimesheetAction(sheet, action);
    await s.save(next);
    res.json(next);
  } catch (err) {
    res.status(err instanceof TimesheetError ? 422 : 500).json({ error: err instanceof Error ? err.message : "action failed" });
  }
});

export default router;
