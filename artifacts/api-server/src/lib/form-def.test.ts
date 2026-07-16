import { test } from "node:test";
import assert from "node:assert/strict";
import { validateForms, validateSubmission, issueWriteFromSubmission, filterIssueWriteToWritable, unwritableMapFields, FormDefError, type FormDef } from "./form-def";

/**
 * Intake form defs — the shape validator, per-submission validation/coercion, and the submission→IssueWrite
 * mapping. Every field must map to a writable issue field (nothing is homeless). Pure; malformed defs or
 * submissions throw {@link FormDefError} (→ 400), never a crash.
 */
const GOOD: unknown = [{
  id: "intake", label: "Work request",
  fields: [
    { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true },
    { key: "priority", label: "Priority", type: "select", mapTo: "priority", options: ["Low", "High"], required: true },
    { key: "hours", label: "Hours", type: "number", mapTo: "estimateHours" },
    { key: "notes", label: "Notes", type: "textarea", mapTo: "description" },
  ],
  target: { kind: "issue", projectId: "proj-001", status: "triage", labels: ["intake"] },
}];

const field = (over: Record<string, unknown> = {}) => ({ key: "s", label: "S", type: "text", mapTo: "title", ...over });

test("validateForms accepts a well-formed form and preserves its shape", () => {
  const forms = validateForms(GOOD);
  assert.equal(forms.length, 1);
  assert.equal(forms[0]!.target.projectId, "proj-001");
  assert.equal(forms[0]!.fields.length, 4);
  assert.equal(forms[0]!.fields[0]!.mapTo, "title");
});

test("validateForms allows an untargeted template (no projectId)", () => {
  const forms = validateForms([{ ...(GOOD as FormDef[])[0], target: { kind: "issue" } }]);
  assert.equal(forms[0]!.target.projectId, undefined);
});

test("validateForms rejects malformed defs", () => {
  assert.throws(() => validateForms("nope"), FormDefError);
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [], target: { kind: "issue" } }]), FormDefError); // no fields
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [field({ type: "select" })], target: { kind: "issue" } }]), FormDefError); // select w/o options
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [field()], target: { kind: "task" } }]), FormDefError); // bad target kind
});

test("validateForms: every field must map to a writable issue field", () => {
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [field({ mapTo: "" })], target: { kind: "issue" } }]), FormDefError); // no mapTo
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [field({ mapTo: "bogusField" })], target: { kind: "issue" } }]), FormDefError); // not a writable issue field
});

test("validateForms: exactly one field maps to title", () => {
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [field({ key: "a", mapTo: "description" })], target: { kind: "issue" } }]), FormDefError); // no title
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [field({ key: "a", mapTo: "title" }), field({ key: "b", mapTo: "title" })], target: { kind: "issue" } }]), FormDefError); // two titles
});

test("validateForms: a scalar target can't be shared (description/labels may be)", () => {
  assert.throws(() => validateForms([{ id: "x", label: "X", fields: [field({ key: "a", mapTo: "title" }), field({ key: "b", mapTo: "priority" }), field({ key: "c", mapTo: "priority" })], target: { kind: "issue" } }]), FormDefError);
  assert.doesNotThrow(() => validateForms([{ id: "x", label: "X", fields: [field({ key: "a", mapTo: "title" }), field({ key: "b", mapTo: "description" }), field({ key: "c", mapTo: "description" })], target: { kind: "issue" } }]));
});

test("validateSubmission enforces required + coerces types", () => {
  const def = validateForms(GOOD)[0]!;
  assert.throws(() => validateSubmission(def, { priority: "Low" }), FormDefError); // missing required summary
  assert.throws(() => validateSubmission(def, { summary: "x", priority: "Nope" }), FormDefError); // bad select option
  assert.throws(() => validateSubmission(def, { summary: "x", priority: "Low", hours: "abc" }), FormDefError); // NaN number
  const clean = validateSubmission(def, { summary: "Fix login", priority: "High", hours: "3", notes: "urgent" });
  assert.deepEqual(clean, { summary: "Fix login", priority: "High", hours: 3, notes: "urgent" });
});

test("issueWriteFromSubmission routes each field to its mapped backend field", () => {
  const def = validateForms(GOOD)[0]!;
  const clean = validateSubmission(def, { summary: "Fix login", priority: "High", hours: 3, notes: "please hurry" });
  const w = issueWriteFromSubmission(def, clean);
  assert.equal(w["projectId"], "proj-001");
  assert.equal(w["title"], "Fix login");        // summary → title
  assert.equal(w["priority"], "High");           // priority → priority
  assert.equal(w["estimateHours"], 3);           // hours → estimateHours
  assert.equal(w["status"], "triage");           // marker
  assert.deepEqual(w["labels"], ["intake"]);     // marker
  assert.match(String(w["description"]), /Notes: please hurry/); // notes → description (only description-mapped fields)
  assert.doesNotMatch(String(w["description"]), /Summary:/);     // summary is NOT dumped into description
});

test("issueWriteFromSubmission omits a field that wasn't answered", () => {
  const def = validateForms(GOOD)[0]!;
  const w = issueWriteFromSubmission(def, validateSubmission(def, { summary: "hi", priority: "Low" }));
  assert.equal(w["estimateHours"], undefined);
  assert.equal(w["description"], undefined);
});

test("validateForms clamps a field maxLength to the absolute ceiling and rejects a bad one", () => {
  const def = validateForms([{ id: "f", label: "F", fields: [field({ maxLength: 999999 })], target: { kind: "issue" } }])[0]!;
  assert.equal(def.fields[0]!.maxLength, 10_000);
  assert.throws(() => validateForms([{ id: "f", label: "F", fields: [field({ maxLength: -1 })], target: { kind: "issue" } }]), FormDefError);
});

test("validateSubmission enforces length caps (own maxLength, else the default)", () => {
  const def = validateForms([{ id: "f", label: "F", fields: [
    field({ key: "t", mapTo: "title", maxLength: 5 }),
    field({ key: "big", label: "Big", type: "textarea", mapTo: "description" }),
  ], target: { kind: "issue", projectId: "p1" } }])[0]!;
  assert.throws(() => validateSubmission(def, { t: "toolong" }), FormDefError);
  assert.throws(() => validateSubmission(def, { big: "x".repeat(2001) }), FormDefError);
  assert.doesNotThrow(() => validateSubmission(def, { t: "ok", big: "x".repeat(2000) }));
});

test("validateSubmission validates email + url formats", () => {
  const def = validateForms([{ id: "f", label: "F", fields: [
    field({ key: "t", mapTo: "title" }),
    field({ key: "email", label: "Email", type: "email", mapTo: "description" }),
    field({ key: "link", label: "Link", type: "url", mapTo: "description" }),
  ], target: { kind: "issue", projectId: "p1" } }])[0]!;
  assert.throws(() => validateSubmission(def, { t: "x", email: "notanemail" }), FormDefError);
  assert.throws(() => validateSubmission(def, { t: "x", link: "javascript:alert(1)" }), FormDefError);
  assert.throws(() => validateSubmission(def, { t: "x", link: "not a url" }), FormDefError);
  const clean = validateSubmission(def, { t: "x", email: "a@b.com", link: "https://ok.example" });
  assert.deepEqual(clean, { t: "x", email: "a@b.com", link: "https://ok.example" });
});

test("unwritableMapFields flags fields whose mapTo the backend can't store (core exempt)", () => {
  const def = validateForms([{ id: "f", label: "F", fields: [
    field({ key: "t", mapTo: "title" }), field({ key: "b", type: "number", mapTo: "budget" }), field({ key: "p", type: "number", mapTo: "storyPoints" }),
  ], target: { kind: "issue", projectId: "p1" } }])[0]!;
  assert.deepEqual(unwritableMapFields(def, new Set(["storyPoints"])), ["budget"]); // title core-exempt; storyPoints writable
});

test("filterIssueWriteToWritable keeps core + advertised fields, drops the rest", () => {
  const issueWrite = { projectId: "p1", title: "T", description: "d", status: "triage", budget: 100, storyPoints: 3 };
  const { issue, dropped } = filterIssueWriteToWritable(issueWrite, new Set(["description", "status", "storyPoints"]));
  assert.deepEqual(issue, { projectId: "p1", title: "T", description: "d", status: "triage", storyPoints: 3 });
  assert.deepEqual(dropped, ["budget"]);
});
