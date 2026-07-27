import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastPi } from "./pi-forecast";

test("clears a backlog in ceil(backlog / velocity) sprints", () => {
  const r = forecastPi({ backlog: 100, velocity: 20 });
  assert.equal(r.likely.sprints, 5); // 100 / 20
  assert.equal(r.likely.pis, 5); // default 1 sprint per PI
  assert.equal(r.feasible, true);
});

test("a partial final sprint is ceilinged to a whole sprint", () => {
  const r = forecastPi({ backlog: 105, velocity: 20 });
  assert.equal(r.likely.sprints, 6); // ceil(5.25)
});

test("sprintsPerPi groups sprints into whole PIs", () => {
  const r = forecastPi({ backlog: 100, velocity: 10, sprintsPerPi: 3 });
  assert.equal(r.likely.sprints, 10);
  assert.equal(r.likely.pis, 4); // ceil(10 / 3)
  assert.equal(r.sprintsPerPi, 3);
});

test("optimistic (faster) yields fewer sprints than pessimistic (slower)", () => {
  const r = forecastPi({ backlog: 100, velocity: 20, optimisticVelocity: 25, pessimisticVelocity: 10 });
  assert.equal(r.optimistic.sprints, 4); // 100 / 25
  assert.equal(r.likely.sprints, 5); // 100 / 20
  assert.equal(r.pessimistic.sprints, 10); // 100 / 10
  assert.ok(r.optimistic.sprints! < r.likely.sprints! && r.likely.sprints! < r.pessimistic.sprints!);
});

test("optimistic/pessimistic default to the likely velocity", () => {
  const r = forecastPi({ backlog: 60, velocity: 20 });
  assert.equal(r.optimistic.sprints, 3);
  assert.equal(r.pessimistic.sprints, 3);
  assert.equal(r.likely.sprints, 3);
});

test("velocity ≤ 0 ⇒ null forecast (never clears), and marks the scenario infeasible", () => {
  const zero = forecastPi({ backlog: 100, velocity: 0 });
  assert.equal(zero.likely.sprints, null);
  assert.equal(zero.likely.pis, null);

  const stalls = forecastPi({ backlog: 100, velocity: 20, pessimisticVelocity: 0 });
  assert.equal(stalls.pessimistic.sprints, null);
  assert.equal(stalls.feasible, false); // pessimistic case never clears
  assert.equal(stalls.likely.sprints, 5); // likely still fine
});

test("an empty backlog ⇒ zero sprints (already done)", () => {
  const r = forecastPi({ backlog: 0, velocity: 20 });
  assert.equal(r.likely.sprints, 0);
  assert.equal(r.likely.pis, 0);
  assert.equal(r.feasible, true);
});

test("negative backlog clamps to 0; sprintsPerPi clamps to ≥ 1", () => {
  const r = forecastPi({ backlog: -50, velocity: 20, sprintsPerPi: 0 });
  assert.equal(r.backlog, 0);
  assert.equal(r.sprintsPerPi, 1);
  assert.equal(r.likely.sprints, 0);
});

test("dirty / non-finite inputs are coerced, never NaN", () => {
  const r = forecastPi({ backlog: "100" as unknown as number, velocity: "20" as unknown as number });
  assert.equal(r.backlog, 100);
  assert.equal(r.likely.sprints, 5);
  assert.equal(Number.isNaN(r.likely.sprints as number), false);
});
