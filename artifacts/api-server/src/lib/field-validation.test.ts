import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateFieldValidation,
  checkFieldValue,
  checkFieldValues,
  resolveFieldType,
  fieldKind,
  FieldValidationError,
  type FieldValidationRule,
} from "./field-validation";

// ── Rule DEFINITION validation ─────────────────────────────────────────────────────
test("accepts a well-formed rule set and drops empty optionals", () => {
  const ok = validateFieldValidation([
    { field: "budget", min: 0, max: 1000000 },
    { field: "name", required: true, min: 1, pattern: "^[A-Za-z]", options: ["", "  "] },
    { field: "stage", options: ["design", "build", "design"] },
  ]);
  assert.equal(ok.length, 3);
  assert.deepEqual(ok[0], { field: "budget", min: 0, max: 1000000 });
  assert.deepEqual(ok[1], { field: "name", required: true, min: 1, pattern: "^[A-Za-z]" }); // blank options dropped
  assert.deepEqual(ok[2], { field: "stage", options: ["design", "build"] }); // deduped
});

test("rejects bad shapes", () => {
  assert.throws(() => validateFieldValidation({} as unknown), /must be an array/);
  assert.throws(() => validateFieldValidation([{ min: 1 }]), /needs a field/);
  assert.throws(() => validateFieldValidation([{ field: "a" }, { field: "a" }]), /duplicate/);
  assert.throws(() => validateFieldValidation([{ field: "a", required: "yes" }]), /required must be a boolean/);
  assert.throws(() => validateFieldValidation([{ field: "a", min: "x" }]), /min must be a number/);
  assert.throws(() => validateFieldValidation([{ field: "a", min: 10, max: 1 }]), /min must be <= max/);
  assert.throws(() => validateFieldValidation([{ field: "a", pattern: "[" }]), /not a valid regular expression/);
  // A pattern that would ReDoS a backtracking engine is ACCEPTED — RE2 runs it in linear time, safely.
  assert.equal(validateFieldValidation([{ field: "a", pattern: "(x+)+" }])[0]!.pattern, "(x+)+");
  assert.throws(() => validateFieldValidation([{ field: "a", after: "not-a-date" }]), /after must be a valid date/);
  assert.throws(() => validateFieldValidation([{ field: "a", after: "2025-12-31", before: "2025-01-01" }]), /after must be on or before before/);
  assert.throws(() => validateFieldValidation([{ field: "a", options: "x" }]), /options must be an array/);
});

test("keeps date bounds and treats a date field as a real date range (not regex/length)", () => {
  const ok = validateFieldValidation([{ field: "goLive", after: "2025-01-01", before: "2025-12-31" }]);
  assert.deepEqual(ok[0], { field: "goLive", after: "2025-01-01", before: "2025-12-31" });
  const rule = ok[0]!;
  assert.equal(checkFieldValue(rule, "2025-06-15", "date"), null);
  assert.match(checkFieldValue(rule, "2024-06-15", "date")!, /on or after 2025-01-01/);
  assert.match(checkFieldValue(rule, "2026-06-15", "date")!, /on or before 2025-12-31/);
  assert.match(checkFieldValue(rule, "not-a-date", "date")!, /must be a valid date/);
});

// ── Value ENFORCEMENT ──────────────────────────────────────────────────────────────
test("fieldKind maps numeric families to number, date to date, the rest to string", () => {
  for (const t of ["number", "currency", "percent", "duration"]) assert.equal(fieldKind(t), "number");
  assert.equal(fieldKind("date"), "date");
  for (const t of ["string", "text", "enum", "labels", "boolean"]) assert.equal(fieldKind(t), "string");
});

test("required rejects empty, but an absent optional value passes untouched", () => {
  const req: FieldValidationRule = { field: "name", required: true, min: 3 };
  assert.match(checkFieldValue(req, "", "string")!, /is required/);
  assert.equal(checkFieldValue({ field: "name", min: 3 }, "", "string"), null); // optional + empty ⇒ ok
});

test("numeric bounds apply to number fields as value bounds", () => {
  const rule: FieldValidationRule = { field: "budget", min: 0, max: 100 };
  assert.equal(checkFieldValue(rule, 50, "number"), null);
  assert.match(checkFieldValue(rule, -1, "number")!, /must be >= 0/);
  assert.match(checkFieldValue(rule, 101, "currency")!, /must be <= 100/);
  assert.match(checkFieldValue(rule, "nope", "number")!, /must be a number/);
});

test("bounds apply to text fields as length bounds; pattern + options enforce", () => {
  assert.match(checkFieldValue({ field: "code", min: 2 }, "x", "string")!, /at least 2 chars/);
  assert.match(checkFieldValue({ field: "code", pattern: "^[A-Z]+$" }, "ab", "string")!, /invalid format/);
  assert.equal(checkFieldValue({ field: "code", pattern: "^[A-Z]+$" }, "AB", "string"), null);
  assert.match(checkFieldValue({ field: "stage", options: ["a", "b"] }, "c", "enum")!, /must be one of: a, b/);
  assert.equal(checkFieldValue({ field: "stage", options: ["a", "b"] }, "b", "enum"), null);
});

test("checkFieldValues collects violations and skips absent optional fields", () => {
  const rules: FieldValidationRule[] = [
    { field: "budget", min: 0 },
    { field: "name", required: true },
    { field: "notes", max: 5 }, // absent + optional ⇒ skipped
  ];
  const errs = checkFieldValues(rules, { budget: -5 }, () => "number");
  // budget < 0, and name is required but absent
  assert.equal(errs.length, 2);
  assert.ok(errs.some((e) => /budget/.test(e)));
  assert.ok(errs.some((e) => /name is required/.test(e)));
});

test("resolveFieldType prefers the canonical catalogue, then custom fields, else string", () => {
  assert.equal(resolveFieldType("name"), "string"); // canonical (name is a string field)
  assert.equal(resolveFieldType("riskAppetite", [{ key: "riskAppetite", type: "number" }]), "number");
  assert.equal(resolveFieldType("totallyUnknown"), "string");
});
