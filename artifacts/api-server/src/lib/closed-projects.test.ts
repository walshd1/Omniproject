import { test } from "node:test";
import assert from "node:assert/strict";
import { validateClosedProjects, planProjectSources, ClosedProjectError, type ClosedProjectRegistry } from "./closed-projects";

test("validateClosedProjects normalises and keeps only known fields", () => {
  const ok = validateClosedProjects({
    "guid-1": { disposition: "sor", source: " jira ", closedAt: "2026-01-01", note: " decommissioned ", junk: "x" },
    "guid-2": { disposition: "archive" },
  });
  assert.deepEqual(ok["guid-1"], { disposition: "sor", source: "jira", closedAt: "2026-01-01", note: "decommissioned" });
  assert.deepEqual(ok["guid-2"], { disposition: "archive" });
});

test("validateClosedProjects rejects bad shapes and dispositions", () => {
  assert.throws(() => validateClosedProjects([]), ClosedProjectError);
  assert.throws(() => validateClosedProjects({ "": { disposition: "sor" } }), /non-empty/);
  assert.throws(() => validateClosedProjects({ g: { disposition: "nowhere" } }), /disposition of sor or archive/);
  assert.throws(() => validateClosedProjects({ g: "x" }), /must be an object/);
});

test("planProjectSources fans GUIDs across live / sor / archive by the registry", () => {
  const registry: ClosedProjectRegistry = {
    "g-sor": { disposition: "sor", source: "jira" },
    "g-arc": { disposition: "archive" },
  };
  const plan = planProjectSources(["g-live", "g-sor", "g-arc", "g-live", "g-arc"], registry);
  assert.deepEqual(plan.live, ["g-live"]); // not in registry ⇒ live (and deduped)
  assert.deepEqual(plan.sor, ["g-sor"]);
  assert.deepEqual(plan.archive, ["g-arc"]);
});

test("planProjectSources: an empty registry means everything is live", () => {
  const plan = planProjectSources(["a", "b"], {});
  assert.deepEqual(plan.live, ["a", "b"]);
  assert.deepEqual(plan.sor, []);
  assert.deepEqual(plan.archive, []);
});
