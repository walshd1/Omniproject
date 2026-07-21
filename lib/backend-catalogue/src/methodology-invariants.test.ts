import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMethodologyInvariants, METHODOLOGY_INVARIANT_KINDS, type InvariantContext } from "./methodology-invariants";
import { getMethodology } from "./methodology-catalogue";

const GTD = { invariants: [{ id: "gtd-next-action", kind: "every-active-project-has-next-action", message: "needs a next action", severity: "warn" as const }] };

test("GTD's next-action invariant flags in-flight projects with no actionable task", () => {
  const ctx: InvariantContext = {
    projects: [
      { id: "p1", status: "active", name: "Alpha" }, // has a next action → OK
      { id: "p2", status: "active", name: "Beta" },  // only a waiting task → breach
      { id: "p3", status: "done" },                   // closed → exempt
      { id: "p4" },                                   // no status ⇒ in-flight, no tasks → breach
    ],
    tasks: [
      { projectId: "p1", status: "next" },
      { projectId: "p1", status: "waiting" },
      { projectId: "p2", status: "waiting" },
      { projectId: "p3", status: "next" },
    ],
  };
  const v = evaluateMethodologyInvariants(GTD, ctx);
  assert.deepEqual(v.map((x) => x.subjectId).sort(), ["p2", "p4"]);
  assert.equal(v[0]!.severity, "warn");
  assert.equal(v.find((x) => x.subjectId === "p2")!.subjectLabel, "Beta");
});

test("a scheduled/someday task is NOT a next action (only the actionable class counts)", () => {
  const ctx: InvariantContext = {
    projects: [{ id: "p1", status: "active" }],
    tasks: [{ projectId: "p1", status: "scheduled" }, { projectId: "p1", status: "someday" }],
  };
  assert.equal(evaluateMethodologyInvariants(GTD, ctx).length, 1); // no `next` task → breach
});

test("no invariants / unknown kind ⇒ no violations (forward-compatible)", () => {
  const ctx: InvariantContext = { projects: [{ id: "p1", status: "active" }], tasks: [] };
  assert.deepEqual(evaluateMethodologyInvariants({}, ctx), []);
  assert.deepEqual(evaluateMethodologyInvariants({ invariants: [{ id: "x", kind: "no-such-kind", message: "m" }] }, ctx), []);
});

test("the shipped GTD methodology declares the next-action invariant with a known kind", () => {
  const gtd = getMethodology("gtd");
  assert.ok(gtd);
  const inv = gtd!.invariants?.find((i) => i.id === "gtd-next-action");
  assert.ok(inv, "GTD ships the next-action invariant");
  assert.ok(METHODOLOGY_INVARIANT_KINDS.includes(inv!.kind), "its kind is a shipped checker");
});
