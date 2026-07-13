import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";
import { registerTimesheetStore, resetTimesheetStore } from "../timesheets/store";
import type { Timesheet } from "../timesheets/state-machine";

/**
 * Timesheets API over the REAL app. The store is BELOW the seam (self-host / backend); here we inject
 * an in-memory store to exercise the full flow + the authoritative state machine + RBAC. Demo mode
 * grants all roles, so the manager-gate positive paths run; the segregation-of-duties block (a sheet
 * can't be approved by its own owner) is enforced by the state machine regardless of role.
 */
let h: Harness;
const ADMIN = adminCookie();

/** A tiny in-memory TimesheetStore for the test. */
function memoryStore() {
  const sheets = new Map<string, Timesheet>();
  return {
    source: "self-host" as const,
    list: async (f: { resourceId?: string; status?: Timesheet["status"] }) =>
      [...sheets.values()].filter((s) => (!f.resourceId || s.resourceId === f.resourceId) && (!f.status || s.status === f.status)),
    get: async (id: string) => sheets.get(id) ?? null,
    save: async (s: Timesheet) => { sheets.set(s.id, s); },
  };
}

before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(resetTimesheetStore);

test("every route is 409 when no timesheet store is configured", async () => {
  const r = await h.req("/timesheets", { cookie: ADMIN });
  assert.equal(r.status, 409);
});

test("POST caps the entries array (write-amplification guard) → 413", async () => {
  const store = memoryStore(); registerTimesheetStore(() => store);
  const entries = Array.from({ length: 1_001 }, (_, i) => ({ id: `e${i}`, projectId: "p1", date: "2026-01-05", hours: 1 }));
  const r = await h.req("/timesheets", { method: "POST", cookie: ADMIN, body: { id: "ts-big", weekStart: "2026-01-05", entries } });
  assert.equal(r.status, 413);
  assert.match(((await r.json()) as { error: string }).error, /Too many entries/);
});

test("POST rejects a malformed entry (non-finite hours) → 400, nothing stored", async () => {
  const store = memoryStore(); registerTimesheetStore(() => store);
  const r = await h.req("/timesheets", { method: "POST", cookie: ADMIN, body: { id: "ts-bad", weekStart: "2026-01-05", entries: [{ id: "e1", projectId: "p1", date: "2026-01-05", hours: "lots" }] } });
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as { error: string }).error, /hours/);
  assert.equal(await store.get("ts-bad"), null);
});

test("sources reports availability", async () => {
  const store = memoryStore(); registerTimesheetStore(() => store);
  const r = await h.req("/timesheets/sources", { cookie: ADMIN });
  const body = (await r.json()) as { available: boolean; source: string | null };
  assert.equal(body.available, true);
  assert.equal(body.source, "self-host");
});

test("draft entry → list → submit round-trips through the store", async () => {
  const store = memoryStore(); registerTimesheetStore(() => store);
  const create = await h.req("/timesheets", { method: "POST", cookie: ADMIN, body: { id: "ts1", weekStart: "2026-01-05", entries: [{ id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 }] } });
  assert.equal(create.status, 200);
  assert.equal((await create.json() as Timesheet).status, "draft");

  const list = await h.req("/timesheets", { cookie: ADMIN });
  assert.equal(((await list.json()) as Timesheet[]).length, 1);

  const submit = await h.req("/timesheets/ts1/action", { method: "POST", cookie: ADMIN, body: { type: "submit" } });
  assert.equal(submit.status, 200);
  assert.equal((await submit.json() as Timesheet).status, "submitted");
});

test("a submitted sheet can't be approved by its own owner (segregation of duties → 422)", async () => {
  const store = memoryStore(); registerTimesheetStore(() => store);
  await h.req("/timesheets", { method: "POST", cookie: ADMIN, body: { id: "ts2", weekStart: "2026-01-05", entries: [{ id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 }] } });
  await h.req("/timesheets/ts2/action", { method: "POST", cookie: ADMIN, body: { type: "submit" } });
  const approve = await h.req("/timesheets/ts2/action", { method: "POST", cookie: ADMIN, body: { type: "approve" } });
  assert.equal(approve.status, 422);
  assert.match((await approve.json() as { error: string }).error, /own owner/);
});

test("submitting an empty sheet is rejected by the state machine (422)", async () => {
  const store = memoryStore(); registerTimesheetStore(() => store);
  await h.req("/timesheets", { method: "POST", cookie: ADMIN, body: { id: "ts3", weekStart: "2026-01-05", entries: [] } });
  const submit = await h.req("/timesheets/ts3/action", { method: "POST", cookie: ADMIN, body: { type: "submit" } });
  assert.equal(submit.status, 422);
});

test("POST validates required fields (400)", async () => {
  const store = memoryStore(); registerTimesheetStore(() => store);
  const r = await h.req("/timesheets", { method: "POST", cookie: ADMIN, body: { id: "x" } });
  assert.equal(r.status, 400);
});
