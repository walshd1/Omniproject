import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTemplates, planInstantiation, TemplateError } from "./project-template";

/** Project templates — validation + the pure instantiation plan. */
const GOOD = [{
  id: "scrum", label: "Scrum project", methodology: "scrum",
  project: { description: "A scrum project.", status: "active" },
  seedIssues: [{ title: "Sprint 0", status: "todo", priority: "high", labels: ["setup"] }, { title: "DoD" }],
}];

test("validateTemplates accepts a well-formed template", () => {
  const t = validateTemplates(GOOD);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.seedIssues!.length, 2);
  assert.equal(t[0]!.project!.status, "active");
});

test("validateTemplates rejects malformed templates", () => {
  assert.throws(() => validateTemplates("nope"), TemplateError);
  assert.throws(() => validateTemplates([{ id: "x" }]), TemplateError); // no label
  assert.throws(() => validateTemplates([{ id: "a", label: "A" }, { id: "a", label: "B" }]), TemplateError); // dup id
  assert.throws(() => validateTemplates([{ id: "x", label: "X", seedIssues: [{ status: "todo" }] }]), TemplateError); // seed w/o title
  assert.throws(() => validateTemplates([{ id: "x", label: "X", project: "nope" }]), TemplateError); // project not object
});

test("planInstantiation: request name wins, else template default, else label; seeds carry over", () => {
  const t = validateTemplates(GOOD)[0]!;
  const named = planInstantiation(t, { name: "Apollo" });
  assert.equal(named.project.name, "Apollo");
  assert.equal(named.project.description, "A scrum project.");
  assert.equal(named.seedIssues.length, 2);

  // no name → falls back to the label (template has no project.name)
  assert.equal(planInstantiation(t, {}).project.name, "Scrum project");
  // programme threads through
  assert.equal(planInstantiation(t, { name: "X", programmeId: "prog-1" }).project.programmeId, "prog-1");
});
