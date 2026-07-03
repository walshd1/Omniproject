import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getRateCard,
  setRateCard,
  getProjectTypes,
  setProjectTypes,
  rollbackRateCard,
  canRollbackRateCard,
  __resetRateCardCache,
} from "./rate-card-store";

/**
 * Rate-card one-generation undo. The tricky part: a single logical mutation (e.g.
 * PUT /rate-card) calls SEVERAL setters synchronously (setRateCard then setProjectTypes) —
 * each is its own persist() call. These must batch into ONE undo point (the state before
 * the first of them), not the state between the last two — otherwise "undo" undoes less
 * than the admin actually just did. Genuinely separate mutations (a real tick apart) must
 * still get separate undo points.
 */
afterEach(() => __resetRateCardCache());

test("no rollback available before any mutation", () => {
  assert.equal(canRollbackRateCard(), false);
  assert.equal(rollbackRateCard(), false);
});

test("multiple synchronous setter calls (one logical mutation) batch into a single undo point", async () => {
  setRateCard({ titles: { h1: "Engineer" }, rates: {} });
  setProjectTypes([{ id: "delivery", label: "Delivery" }]);
  assert.equal(canRollbackRateCard(), true);
  await Promise.resolve(); // flush the microtask queue — closes the first batch

  // A second logical mutation, also multi-setter, synchronously.
  setRateCard({ titles: {}, rates: {} });
  setProjectTypes([]);
  assert.deepEqual(getRateCard().titles, {});
  assert.deepEqual(getProjectTypes(), []);

  // Rollback must restore the state from BEFORE the second mutation's *first* setter call,
  // not the state between its two setter calls.
  assert.equal(rollbackRateCard(), true);
  assert.deepEqual(getRateCard().titles, { h1: "Engineer" });
  assert.deepEqual(getProjectTypes(), [{ id: "delivery", label: "Delivery" }]);
});

test("rollback is one-shot: a second rollback right after is a no-op", async () => {
  setRateCard({ titles: { h1: "Engineer" }, rates: {} });
  await Promise.resolve(); // flush the microtask queue — closes the first batch
  setRateCard({ titles: {}, rates: {} });
  assert.equal(rollbackRateCard(), true);
  assert.equal(canRollbackRateCard(), false);
  assert.equal(rollbackRateCard(), false);
  assert.deepEqual(getRateCard().titles, { h1: "Engineer" }); // unchanged by the no-op
});

test("mutations separated by a real tick get separate undo points", async () => {
  setRateCard({ titles: { h1: "Engineer" }, rates: {} });
  await Promise.resolve(); // flush the microtask queue — closes the first batch
  setRateCard({ titles: { h1: "Engineer", h2: "Manager" }, rates: {} });
  await Promise.resolve();
  setRateCard({ titles: {}, rates: {} });

  // Undo restores only the immediately-prior mutation, not both.
  assert.equal(rollbackRateCard(), true);
  assert.deepEqual(getRateCard().titles, { h1: "Engineer", h2: "Manager" });
});
