import { test } from "node:test";
import assert from "node:assert/strict";
import { isComposed, isEnabledId, filterComposed, type Composition } from "./composition";

/** The shared composition primitive — one predicate behind the SPA filter and the backend hard gate. */

test("null composition = relaxed: everything is enabled", () => {
  assert.equal(isComposed(null, "report", "evm"), true);
  assert.equal(isEnabledId(null, "report:evm"), true);
});

test("curated composition = strict: only listed ids", () => {
  const c: Composition = ["report:burndown", "report:velocity", "view:board"];
  assert.equal(isComposed(c, "report", "burndown"), true);
  assert.equal(isComposed(c, "report", "evm"), false);     // curated out
  assert.equal(isComposed(c, "view", "board"), true);
  assert.equal(isComposed(c, "output", "odata"), false);
});

test("filterComposed keeps only enabled items (all when uncurated)", () => {
  const reports = [{ id: "burndown" }, { id: "evm" }, { id: "velocity" }];
  assert.deepEqual(filterComposed(null, "report", reports, (r) => r.id).map((r) => r.id), ["burndown", "evm", "velocity"]);
  assert.deepEqual(
    filterComposed(["report:burndown", "report:velocity"], "report", reports, (r) => r.id).map((r) => r.id),
    ["burndown", "velocity"],
  );
});
