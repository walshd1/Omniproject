import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedHoursByResource, approvedItemsFrom } from "./actuals";
import type { TimesheetStore } from "./store";
import type { Timesheet } from "./state-machine";

/**
 * Timesheet actuals — approved hours per resource, then synthetic internal-time items so the figure
 * flows through the existing staffCost math. Only APPROVED sheets and only the target project count.
 */

/** A tiny in-memory store seeded with fixed sheets. */
function storeOf(sheets: Timesheet[]): TimesheetStore {
  return {
    source: "self-host",
    list: async (f) => sheets.filter((s) => (!f.resourceId || s.resourceId === f.resourceId) && (!f.status || s.status === f.status)),
    get: async (id) => sheets.find((s) => s.id === id) ?? null,
    save: async () => {},
  };
}

const sheet = (id: string, resourceId: string, status: Timesheet["status"], entries: Timesheet["entries"]): Timesheet =>
  ({ id, resourceId, weekStart: "2026-01-05", status, entries });

test("sums approved hours per resource for the target project only", async () => {
  const store = storeOf([
    sheet("a1", "ada", "approved", [
      { id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 },
      { id: "e2", projectId: "p1", date: "2026-01-06", hours: 4 },
      { id: "e3", projectId: "p2", date: "2026-01-07", hours: 5 }, // other project — excluded
    ]),
    sheet("a2", "grace", "approved", [{ id: "e4", projectId: "p1", date: "2026-01-05", hours: 6 }]),
    sheet("a3", "ada", "submitted", [{ id: "e5", projectId: "p1", date: "2026-01-05", hours: 3 }]), // not approved — excluded
  ]);
  const byResource = await approvedHoursByResource(store, "p1");
  assert.deepEqual(byResource, { ada: 12, grace: 6 });
});

test("non-finite hours are ignored, not NaN-propagated", async () => {
  const store = storeOf([
    sheet("a1", "ada", "approved", [
      { id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 },
      { id: "e2", projectId: "p1", date: "2026-01-06", hours: Number.NaN },
    ]),
  ]);
  assert.deepEqual(await approvedHoursByResource(store, "p1"), { ada: 8 });
});

test("no approved sheets → empty map, no items", async () => {
  const store = storeOf([sheet("a1", "ada", "draft", [{ id: "e1", projectId: "p1", date: "2026-01-05", hours: 8 }])]);
  const byResource = await approvedHoursByResource(store, "p1");
  assert.deepEqual(byResource, {});
  assert.deepEqual(approvedItemsFrom(byResource), []);
});

test("approvedItemsFrom emits one internal (billable:false) item per resource", () => {
  const items = approvedItemsFrom({ ada: 12, grace: 6 });
  assert.deepEqual(items, [
    { assignee: "ada", loggedHours: 12, billable: false },
    { assignee: "grace", loggedHours: 6, billable: false },
  ]);
});
