import { test } from "node:test";
import assert from "node:assert/strict";
import { billableItemsFrom, labourLinesFromStaffCost } from "./invoice-autobuild";
import type { StaffCost } from "./rate-card";

/**
 * Invoice auto-build (Invoice Ninja phase 3) — the PURE builders that turn a client-facing staff-cost
 * roll-up into DRAFT labour lines. The wiring (route + store) is exercised by the route suite; here we
 * pin the deterministic maths + skip rules.
 */

function staffCostFixture(rows: StaffCost["byTitle"]): StaffCost {
  const clientCost = rows.reduce((s, r) => s + r.cost, 0);
  const charge = rows.reduce((s, r) => s + r.charge, 0);
  return { internalCost: 0, clientCost, totalCost: clientCost, charge, margin: charge - clientCost, unratedHours: 0, byTitle: rows };
}

test("billableItemsFrom marks every approved-hours bucket as client-facing (billable)", () => {
  const items = billableItemsFrom({ alice: 10, bob: 5 });
  assert.deepEqual(items, [
    { assignee: "alice", loggedHours: 10, billable: true },
    { assignee: "bob", loggedHours: 5, billable: true },
  ]);
});

test("billableItemsFrom is empty for no approved hours", () => {
  assert.deepEqual(billableItemsFrom({}), []);
});

test("labourLinesFromStaffCost builds one labour line per costed role (qty=hours, unitPrice=charge/hours)", () => {
  const cost = staffCostFixture([
    { titleHash: "h1", titleLabel: "Engineer", hours: 10, cost: 800, charge: 960 },
    { titleHash: "h2", titleLabel: "Designer", hours: 5, cost: 200, charge: 240 },
  ]);
  const lines = labourLinesFromStaffCost(cost);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0], { kind: "labour", description: "Engineer — labour (10h)", quantity: 10, unitPrice: 96 });
  assert.deepEqual(lines[1], { kind: "labour", description: "Designer — labour (5h)", quantity: 5, unitPrice: 48 });
});

test("labourLinesFromStaffCost skips roles with no charge or no hours (internal/unrated time never bills)", () => {
  const cost = staffCostFixture([
    { titleHash: "h1", titleLabel: "Engineer", hours: 8, cost: 640, charge: 800 },
    { titleHash: "h2", titleLabel: "Intern (internal)", hours: 4, cost: 0, charge: 0 }, // no charge → skipped
    { titleHash: "h3", titleLabel: "Ghost", hours: 0, cost: 0, charge: 0 }, // no hours → skipped
  ]);
  const lines = labourLinesFromStaffCost(cost);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.description, "Engineer — labour (8h)");
});

test("labourLinesFromStaffCost rounds fractional hours and unit price to 2dp", () => {
  const cost = staffCostFixture([{ titleHash: "h1", titleLabel: "Analyst", hours: 3.333, cost: 90, charge: 100 }]);
  const [line] = labourLinesFromStaffCost(cost);
  assert.equal(line!.quantity, 3.33);
  assert.equal(line!.unitPrice, round(100 / 3.333));
  assert.equal(line!.kind, "labour");
});

function round(n: number): number { return Math.round(n * 100) / 100; }
