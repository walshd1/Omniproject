import { test } from "node:test";
import assert from "node:assert/strict";
import { formContainerErrors, validateSubmission, issueWriteFromSubmission, filterIssueWriteToWritable, unwritableMapFields, FormDefError, type FormDef } from "./form-def";

/**
 * Intake form defs — validated by the ENGINE (container floors + field-primitive per-field checks via
 * formContainerErrors), per-submission validation/coercion, and the submission→IssueWrite mapping. Every field
 * must map to a writable issue field (nothing is homeless). Malformed submissions throw {@link FormDefError}.
 */
const GOOD_FORM = {
  id: "intake", label: "Work request",
  fields: [
    { key: "summary", label: "Summary", type: "text", mapTo: "title", required: true },
    { key: "priority", label: "Priority", type: "select", mapTo: "priority", options: ["Low", "High"], required: true },
    { key: "hours", label: "Hours", type: "number", mapTo: "estimateHours" },
    { key: "notes", label: "Notes", type: "textarea", mapTo: "description" },
  ],
  target: { kind: "issue", projectId: "proj-001", status: "triage", labels: ["intake"] },
} as unknown as FormDef;

const field = (over: Record<string, unknown> = {}) => ({ key: "s", label: "S", type: "text", mapTo: "title", ...over });
/** Build a form def and return its engine validation errors ([] = sound). */
const errs = (fields: unknown[], target: unknown = { kind: "issue" }): string[] =>
  formContainerErrors({ id: "x", label: "X", fields, target } as unknown as FormDef);

test("formContainerErrors accepts a well-formed form (container + per-field)", () => {
  assert.deepEqual(formContainerErrors(GOOD_FORM), []);
});

test("formContainerErrors: a drifted def (missing/duplicate title) is caught at the point of use", () => {
  const noTitle = { ...GOOD_FORM, fields: GOOD_FORM.fields.filter((f) => f.mapTo !== "title") } as FormDef;
  assert.ok(formContainerErrors(noTitle).length >= 1);
  const twoTitle = { ...GOOD_FORM, fields: [...GOOD_FORM.fields, { key: "t2", label: "T2", type: "text" as const, mapTo: "title" }] } as FormDef;
  assert.ok(formContainerErrors(twoTitle).length >= 1);
});

test("an untargeted template (no projectId) is still a sound def", () => {
  assert.deepEqual(formContainerErrors({ ...GOOD_FORM, target: { kind: "issue" } } as FormDef), []);
});

test("engine rejects malformed forms", () => {
  assert.ok(errs([]).length >= 1);                                     // no fields (container min-fields floor)
  assert.ok(errs([field({ type: "select" })]).length >= 1);           // select w/o options
  assert.ok(errs([field()], { kind: "task" }).length >= 1);           // bad target kind
});

test("every field must map to a writable issue field (the mapTo floor)", () => {
  assert.ok(errs([field({ mapTo: "" })]).length >= 1);                 // no mapTo
  assert.ok(errs([field({ mapTo: "bogusField" })]).length >= 1);      // not a writable issue field
});

test("exactly one field maps to title", () => {
  assert.ok(errs([field({ key: "a", mapTo: "description" })]).length >= 1);                                   // no title
  assert.ok(errs([field({ key: "a", mapTo: "title" }), field({ key: "b", mapTo: "title" })]).length >= 1);   // two titles
});

test("a scalar target can't be shared (description/labels may be)", () => {
  assert.ok(errs([field({ key: "a", mapTo: "title" }), field({ key: "b", mapTo: "priority" }), field({ key: "c", mapTo: "priority" })]).length >= 1);
  assert.deepEqual(errs([field({ key: "a", mapTo: "title" }), field({ key: "b", mapTo: "description" }), field({ key: "c", mapTo: "description" })]), []);
});

test("validateSubmission enforces required + coerces types", () => {
  const def = GOOD_FORM;
  assert.throws(() => validateSubmission(def, { priority: "Low" }), FormDefError); // missing required summary
  assert.throws(() => validateSubmission(def, { summary: "x", priority: "Nope" }), FormDefError); // bad select option
  assert.throws(() => validateSubmission(def, { summary: "x", priority: "Low", hours: "abc" }), FormDefError); // NaN number
  const clean = validateSubmission(def, { summary: "Fix login", priority: "High", hours: "3", notes: "urgent" });
  assert.deepEqual(clean, { summary: "Fix login", priority: "High", hours: 3, notes: "urgent" });
});

test("issueWriteFromSubmission routes each field to its mapped backend field", () => {
  const def = GOOD_FORM;
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
  const def = GOOD_FORM;
  const w = issueWriteFromSubmission(def, validateSubmission(def, { summary: "hi", priority: "Low" }));
  assert.equal(w["estimateHours"], undefined);
  assert.equal(w["description"], undefined);
});

test("maxLength: the hard ceiling bites at SUBMISSION; a negative maxLength is an invalid def", () => {
  // A huge authored maxLength is a sound def (positive); the absolute ceiling is enforced when the value lands.
  const bigDef = { id: "f", label: "F", fields: [field({ maxLength: 999999 })], target: { kind: "issue", projectId: "p1" } } as unknown as FormDef;
  assert.deepEqual(formContainerErrors(bigDef), []);
  assert.throws(() => validateSubmission(bigDef, { s: "x".repeat(10_001) }), FormDefError);
  assert.doesNotThrow(() => validateSubmission(bigDef, { s: "x".repeat(10_000) }));
  // A negative maxLength is rejected by the field-primitive bound.
  assert.ok(formContainerErrors({ id: "f", label: "F", fields: [field({ maxLength: -1 })], target: { kind: "issue" } } as unknown as FormDef).length >= 1);
});

test("validateSubmission enforces length caps (own maxLength, else the default)", () => {
  const def = { id: "f", label: "F", fields: [
    field({ key: "t", mapTo: "title", maxLength: 5 }),
    field({ key: "big", label: "Big", type: "textarea", mapTo: "description" }),
  ], target: { kind: "issue", projectId: "p1" } } as unknown as FormDef;
  assert.throws(() => validateSubmission(def, { t: "toolong" }), FormDefError);
  assert.throws(() => validateSubmission(def, { big: "x".repeat(2001) }), FormDefError);
  assert.doesNotThrow(() => validateSubmission(def, { t: "ok", big: "x".repeat(2000) }));
});

test("validateSubmission validates email + url formats", () => {
  const def = { id: "f", label: "F", fields: [
    field({ key: "t", mapTo: "title" }),
    field({ key: "email", label: "Email", type: "email", mapTo: "description" }),
    field({ key: "link", label: "Link", type: "url", mapTo: "description" }),
  ], target: { kind: "issue", projectId: "p1" } } as unknown as FormDef;
  assert.throws(() => validateSubmission(def, { t: "x", email: "notanemail" }), FormDefError);
  assert.throws(() => validateSubmission(def, { t: "x", link: "javascript:alert(1)" }), FormDefError);
  assert.throws(() => validateSubmission(def, { t: "x", link: "not a url" }), FormDefError);
  const clean = validateSubmission(def, { t: "x", email: "a@b.com", link: "https://ok.example" });
  assert.deepEqual(clean, { t: "x", email: "a@b.com", link: "https://ok.example" });
});

test("unwritableMapFields flags fields whose mapTo the backend can't store (core exempt)", () => {
  const def = { id: "f", label: "F", fields: [
    field({ key: "t", mapTo: "title" }), field({ key: "b", type: "number", mapTo: "budget" }), field({ key: "p", type: "number", mapTo: "storyPoints" }),
  ], target: { kind: "issue", projectId: "p1" } } as unknown as FormDef;
  assert.deepEqual(unwritableMapFields(def, new Set(["storyPoints"])), ["budget"]); // title core-exempt; storyPoints writable
});

test("filterIssueWriteToWritable keeps core + advertised fields, drops the rest", () => {
  const issueWrite = { projectId: "p1", title: "T", description: "d", status: "triage", budget: 100, storyPoints: 3 };
  const { issue, dropped } = filterIssueWriteToWritable(issueWrite, new Set(["description", "status", "storyPoints"]));
  assert.deepEqual(issue, { projectId: "p1", title: "T", description: "d", status: "triage", storyPoints: 3 });
  assert.deepEqual(dropped, ["budget"]);
});

test("new field primitives validate + serialise (radio, likert, yesno, multiselect, address)", () => {
  const def = { id: "f", label: "F", fields: [
    { key: "t", label: "T", type: "text", mapTo: "title" },
    { key: "rad", label: "Rad", type: "radio", mapTo: "priority", options: ["low", "high"] },
    { key: "lik", label: "Agree?", type: "likert", mapTo: "description" }, // options defaulted at submission
    { key: "yn", label: "Billable?", type: "yesno", mapTo: "description" },
    { key: "ms", label: "Tags", type: "multiselect", mapTo: "labels", options: ["a", "b", "c"] },
    { key: "addr", label: "Site", type: "address", mapTo: "description" },
  ], target: { kind: "issue", projectId: "p1" } } as unknown as FormDef;

  assert.deepEqual(formContainerErrors(def), []); // a likert without options is a sound def (its scale defaults)

  // radio must be one of its options; multiselect items must all be valid.
  assert.throws(() => validateSubmission(def, { t: "x", rad: "nope" }), FormDefError);
  assert.throws(() => validateSubmission(def, { t: "x", ms: ["a", "z"] }), FormDefError);

  const clean = validateSubmission(def, {
    t: "Move office", rad: "high", lik: "Agree", yn: "yes",
    ms: ["a", "c"], addr: { line1: "1 High St", city: "Leeds", postcode: "LS1", country: "UK", junk: "x" },
  });
  assert.deepEqual(clean["ms"], ["a", "c"]);       // array value
  assert.equal(clean["yn"], true);                  // boolean
  assert.deepEqual(clean["addr"], { line1: "1 High St", city: "Leeds", postcode: "LS1", country: "UK" }); // junk dropped

  const w = issueWriteFromSubmission(def, clean);
  assert.equal(w["priority"], "high");              // radio → scalar
  assert.deepEqual(w["labels"], ["a", "c"]);        // multiselect → labels array (fanned out)
  assert.match(String(w["description"]), /Agree\?: Agree/);       // likert into description
  assert.match(String(w["description"]), /Billable\?: true/);     // yesno serialised
  assert.match(String(w["description"]), /Site: 1 High St, Leeds, LS1, UK/); // address serialised
});
