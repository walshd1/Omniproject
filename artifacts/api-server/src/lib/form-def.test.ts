import { test } from "node:test";
import assert from "node:assert/strict";
import { validateForms, validateSubmission, issueWriteFromSubmission, FormDefError, type FormDef } from "./form-def";

/**
 * Intake form defs — the shape validator, per-submission validation/coercion, and the submission→IssueWrite
 * mapping. Pure; malformed defs or submissions must throw {@link FormDefError} (→ 400), never a crash.
 */
const GOOD: unknown = [{
  id: "intake", label: "Work request",
  fields: [
    { key: "summary", label: "Summary", type: "text", required: true },
    { key: "priority", label: "Priority", type: "select", options: ["Low", "High"], required: true },
    { key: "hours", label: "Hours", type: "number" },
    { key: "urgent", label: "Urgent", type: "checkbox" },
  ],
  target: { kind: "issue", projectId: "proj-001", titleFrom: "summary", status: "triage", labels: ["intake"], map: { priority: "priority" } },
}];

test("validateForms accepts a well-formed form and preserves its shape", () => {
  const forms = validateForms(GOOD);
  assert.equal(forms.length, 1);
  assert.equal(forms[0]!.target.projectId, "proj-001");
  assert.equal(forms[0]!.fields.length, 4);
});

test("validateForms allows an untargeted template (no projectId)", () => {
  const forms = validateForms([{ ...(GOOD as FormDef[])[0], target: { kind: "issue", titleFrom: "summary" } }]);
  assert.equal(forms[0]!.target.projectId, undefined);
});

test("validateForms rejects malformed defs", () => {
  assert.throws(() => validateForms("nope"), FormDefError);
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [], target: { kind: "issue" } }]), FormDefError); // no fields
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [{ key: "a", label: "A", type: "select" }], target: { kind: "issue" } }]), FormDefError); // select w/o options
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [{ key: "a", label: "A", type: "text" }], target: { kind: "task" } }]), FormDefError); // bad target kind
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [{ key: "a", label: "A", type: "text" }], target: { kind: "issue", map: { notAField: "a" } } }]), FormDefError); // map to non-issue field
});

test("validateForms rejects a map that points at an unknown field", () => {
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [{ key: "a", label: "A", type: "text" }], target: { kind: "issue", map: { title: "ghost" } } }]), FormDefError);
});

test("validateSubmission enforces required + coerces types", () => {
  const def = validateForms(GOOD)[0]!;
  assert.throws(() => validateSubmission(def, { priority: "Low" }), FormDefError); // missing required summary
  assert.throws(() => validateSubmission(def, { summary: "x", priority: "Nope" }), FormDefError); // bad select option
  assert.throws(() => validateSubmission(def, { summary: "x", priority: "Low", hours: "abc" }), FormDefError); // NaN number
  const clean = validateSubmission(def, { summary: "Fix login", priority: "High", hours: "3", urgent: "true" });
  assert.deepEqual(clean, { summary: "Fix login", priority: "High", hours: 3, urgent: true });
});

test("issueWriteFromSubmission maps to an IssueWrite with title, description, marker + mapped fields", () => {
  const def = validateForms(GOOD)[0]!;
  const clean = validateSubmission(def, { summary: "Fix login", priority: "High" });
  const w = issueWriteFromSubmission(def, clean);
  assert.equal(w["projectId"], "proj-001");
  assert.equal(w["title"], "Fix login"); // from titleFrom
  assert.equal(w["status"], "triage");
  assert.deepEqual(w["labels"], ["intake"]);
  assert.equal(w["priority"], "High"); // mapped
  assert.match(String(w["description"]), /Summary: Fix login/);
  assert.match(String(w["description"]), /Priority: High/);
});

test("issueWriteFromSubmission falls back to the form label as title when titleFrom is unset", () => {
  const def = validateForms([{ ...(GOOD as FormDef[])[0], target: { kind: "issue", projectId: "p1" } }])[0]!;
  const w = issueWriteFromSubmission(def, validateSubmission(def, { summary: "hi", priority: "Low" }));
  assert.equal(w["title"], "Work request");
});
