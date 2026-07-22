import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveFieldPolicy,
  sanitiseValue,
  sanitiseForStore,
  sanitiseKeystroke,
  escapeForOutput,
  validateValue,
  applyFieldPolicy,
  assertFieldHasPolicy,
  isLabelType,
} from "./field-validation";

/**
 * The field policy floor: every field that captures input (type ≠ label) resolves to a sanitise policy AND a
 * validation spec, with secure defaults by type. A `label` field is the one exemption. Author overrides tighten
 * the floor; they can never remove sanitisation.
 */

test("a label field is display-only — exempt from the policy floor", () => {
  assert.equal(isLabelType("label"), true);
  assert.equal(assertFieldHasPolicy("label"), null);
  const p = resolveFieldPolicy("label");
  assert.deepEqual(p.sanitise, []);
});

test("EVERY non-label field type resolves to a non-empty sanitise policy", () => {
  const types = ["text", "textarea", "email", "url", "number", "date", "select", "radio", "single-choice", "multiselect", "multi-choice", "checkbox", "yesno", "boolean", "likert", "address"];
  for (const t of types) {
    const p = resolveFieldPolicy(t);
    assert.ok(p.sanitise.length > 0, `${t} must sanitise`);
    assert.equal(assertFieldHasPolicy(t, undefined, t), null, `${t} passes the contract check`);
  }
});

test("the per-keystroke filter drops only never-valid characters (keeps legitimate < >)", () => {
  // Free text keeps < > (they are legitimate; they get ESCAPED at output, not stripped) — only control chars go.
  assert.equal(sanitiseKeystroke("a<b>c", "text"), "a<b>c");
  assert.equal(sanitiseKeystroke("x\tyz", "text"), "xyz"); // control chars (tab) stripped always
  // Number: only numeric characters survive each keystroke.
  assert.equal(sanitiseKeystroke("12a3.5x", "number"), "123.5");
  // Email/url: no whitespace.
  assert.equal(sanitiseKeystroke("foo @bar.com", "email"), "foo@bar.com");
});

test("storage sanitisation NORMALISES but never escapes; escaping is an output-boundary job", () => {
  // Storage keeps < > (round-trip safe) — it only trims/normalises.
  assert.equal(sanitiseForStore("  a <b> c  ", resolveFieldPolicy("text").sanitise), "a <b> c");
  // The invariant "unescaped chars are never parsed" is enforced by escaping at OUTPUT.
  assert.equal(escapeForOutput("a <b> c"), "a &lt;b&gt; c");
  // Re-storing an already-stored value does not mangle it (no double-encoding).
  const once = sanitiseForStore("a <b> c", resolveFieldPolicy("text").sanitise);
  assert.equal(sanitiseForStore(once, resolveFieldPolicy("text").sanitise), once);
});

test("free text sanitises HTML and trims", () => {
  assert.equal(sanitiseValue("  <b>hi</b>  ", resolveFieldPolicy("text").sanitise), "&lt;b&gt;hi&lt;/b&gt;");
});

test("email lowercases + trims and validates the address shape", () => {
  const policy = resolveFieldPolicy("email");
  const { value, errors } = applyFieldPolicy("  Foo@Bar.COM ", policy, "Email");
  assert.equal(value, "foo@bar.com");
  assert.deepEqual(errors, []);
  assert.deepEqual(applyFieldPolicy("not-an-email", policy, "Email").errors, ["Email must be a valid email address"]);
});

test("number keeps only numeric characters", () => {
  assert.equal(sanitiseValue("abc-12.5xyz", resolveFieldPolicy("number").sanitise), "-12.5");
});

test("a single-choice field validates its value against its options", () => {
  const policy = resolveFieldPolicy("single-choice", { options: ["low", "high"] });
  assert.deepEqual(validateValue("high", policy.validation, "Level"), []);
  assert.deepEqual(validateValue("nope", policy.validation, "Level"), ['Level: "nope" is not an allowed option']);
});

test("a multi-choice field validates every member of the comma-joined set", () => {
  const policy = resolveFieldPolicy("multi-choice", { options: ["a", "b", "c"] });
  assert.deepEqual(validateValue("a,b", policy.validation, "Tags"), []);
  assert.deepEqual(validateValue("a,x", policy.validation, "Tags"), ['Tags: "x" is not an allowed option']);
});

test("required + length + pattern bounds are enforced", () => {
  assert.deepEqual(validateValue("", { required: true }, "Name"), ["Name is required"]);
  assert.deepEqual(validateValue("abcdef", { maxLength: 3 }, "Name"), ["Name must be at most 3 characters"]);
  assert.deepEqual(validateValue("ab", { minLength: 3 }, "Name"), ["Name must be at least 3 characters"]);
  assert.deepEqual(validateValue("5", { min: 1, max: 3 }, "N"), ["N must be at most 3"]);
});

test("author overrides TIGHTEN but never remove the secure default sanitisation", () => {
  // Asking for only "trim" cannot drop the type's escape-html floor — the result is the union.
  const policy = resolveFieldPolicy("text", { sanitise: ["trim"] });
  assert.ok(policy.sanitise.includes("escape-html"), "escape-html floor survives an author override");
  // A tighter maxLength override wins.
  assert.equal(resolveFieldPolicy("text", { validation: { maxLength: 10 } }).validation.maxLength, 10);
});
