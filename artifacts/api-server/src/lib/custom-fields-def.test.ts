import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCustomFieldDef, customFieldToEnumerated, CustomFieldError } from "./custom-fields";

/**
 * Custom-field DEFS (roadmap §4.6) — the org/programme extension of the superset, authored via the importer.
 * Its definition (type/length/pattern + home) lives in the superset; its data lives at the home (default: the
 * sidecar). Proves validation + the enumerated-field projection used to union it into the live superset.
 */

test("validateCustomFieldDef accepts a rich definition (constraints + home) and defaults the home to the sidecar", () => {
  const cf = validateCustomFieldDef({ key: "postcode", label: "Postcode", type: "string", maxLength: 8, pattern: "^[A-Z0-9 ]{5,8}$" });
  assert.equal(cf.key, "postcode");
  assert.equal(cf.maxLength, 8);
  const { broker, system, field } = customFieldToEnumerated(cf);
  assert.equal(broker, "builtin");     // fronted by the built-in broker
  assert.equal(system, "sidecar");     // homed in the sidecar by default
  assert.equal(field.sourceField, "postcode");
  assert.equal(field.pattern, "^[A-Z0-9 ]{5,8}$");
});

test("a custom field can declare an EXTERNAL home instead of the sidecar", () => {
  const cf = validateCustomFieldDef({ key: "region", label: "Region", type: "string", broker: "n8n", backend: "sap", sourceField: "ZREGION" });
  assert.deepEqual(customFieldToEnumerated(cf), {
    broker: "n8n", system: "sap",
    field: { key: "region", label: "Region", type: "string", surface: true, store: true, sourceSystem: "sap", sourceField: "ZREGION" },
  });
});

test("validateCustomFieldDef rejects shadowing a canonical field, a bad key, an invalid type, and an unsafe regex", () => {
  assert.throws(() => validateCustomFieldDef({ key: "title", label: "T", type: "string" }), CustomFieldError); // shadows canonical
  assert.throws(() => validateCustomFieldDef({ key: "1bad", label: "T", type: "string" }), CustomFieldError);
  assert.throws(() => validateCustomFieldDef({ key: "ok", label: "T", type: "nope" }), CustomFieldError);
  assert.throws(() => validateCustomFieldDef({ key: "ok", label: "T", type: "string", pattern: "[" }), CustomFieldError);
});
