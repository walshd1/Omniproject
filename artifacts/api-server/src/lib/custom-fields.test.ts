import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCustomFields, validateCustomFieldSources, CustomFieldError, type CustomField } from "./custom-fields";
import type { FieldRoute } from "./field-routing";

const cf = (over: Partial<CustomField> = {}): CustomField => ({ key: "riskAppetite", label: "Risk appetite", type: "string", ...over });

test("accepts well-formed custom fields and trims", () => {
  const ok = validateCustomFields([{ key: " riskAppetite ", label: " Risk appetite ", type: "string" }, cf({ key: "sponsorTier", type: "number" })]);
  assert.equal(ok.length, 2);
  assert.deepEqual(ok[0], { key: "riskAppetite", label: "Risk appetite", type: "string" });
});

test("rejects a key that shadows a superset field, a bad key, a dup, a bad type, a missing label", () => {
  assert.throws(() => validateCustomFields([cf({ key: "status" })]), /already a superset field/); // canonical
  assert.throws(() => validateCustomFields([cf({ key: "has spaces" })]), CustomFieldError);
  assert.throws(() => validateCustomFields([cf(), cf()]), /duplicate/);
  assert.throws(() => validateCustomFields([cf({ type: "json" as never })]), /invalid type/);
  assert.throws(() => validateCustomFields([cf({ label: "" })]), /needs a label/);
  assert.throws(() => validateCustomFields({} as unknown), CustomFieldError);
});

// ── The source rule ──────────────────────────────────────────────────────────────
const route = (uiElement: string): FieldRoute => ({ uiElement, vendor: "jira", broker: "n8n", sourceField: "cf_1" });

test("source rule: a MAPPED custom field is fine even with no built-in backend", () => {
  validateCustomFieldSources([cf()], [route("riskAppetite")], /* builtinActive */ false); // does not throw
});

test("source rule: an UNMAPPED custom field is fine when the built-in backend holds it", () => {
  validateCustomFieldSources([cf()], [], /* builtinActive */ true); // does not throw
});

test("source rule: an unmapped field with NO built-in backend is rejected (no data source)", () => {
  assert.throws(
    () => validateCustomFieldSources([cf()], [], false),
    (e: unknown) => e instanceof CustomFieldError && /no data source/.test((e as Error).message),
  );
});
