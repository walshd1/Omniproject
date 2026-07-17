import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLiveSuperset, sidecarEnumeratedFields, fieldRefFromSuperset, type SupersetInput } from "./superset";
import { sanitizeMapping } from "./mapping";
import type { EnumeratedField } from "./field-registry";

/**
 * The live superset (§4.6): the union of connected backends' fields, duplicates kept DISTINCT, expanding and
 * shrinking with the connected set; the sidecar advertises the whole canonical vocabulary.
 */

const jira: EnumeratedField[] = [
  { key: "title", label: "Summary", type: "string", sourceSystem: "jira", sourceField: "summary", maxLength: 255 },
  { key: "storyPoints", label: "Story points", type: "number", sourceSystem: "jira", sourceField: "customfield_10016", precision: 0 },
];
const todoist: EnumeratedField[] = [
  { key: "title", label: "Content", type: "string", sourceSystem: "todoist", sourceField: "content", maxLength: 500 },
];

test("duplicates are kept DISTINCT: two backends' `title` are two entries, each with its own origin + limits", () => {
  const sup = buildLiveSuperset([{ broker: "n8n", system: "jira", fields: jira }, { broker: "n8n", system: "todoist", fields: todoist }]);
  const titles = sup.filter((s) => s.canonicalKey === "title");
  assert.equal(titles.length, 2);
  const j = titles.find((t) => t.system === "jira")!;
  const t = titles.find((t) => t.system === "todoist")!;
  assert.equal(j.nativeField, "summary");
  assert.equal(j.maxLength, 255);
  assert.equal(t.nativeField, "content");
  assert.equal(t.maxLength, 500);      // Todoist's own limit — distinct from Jira's
  assert.notEqual(j.id, t.id);
});

test("it carries the three things a mapping needs: origin, type, and constraints", () => {
  const [f] = buildLiveSuperset([{ broker: "n8n", system: "jira", fields: jira }]);
  assert.equal(f!.system, "jira");             // where it originated
  assert.equal(f!.nativeField, "summary");
  assert.equal(f!.type, "string");             // what type
  assert.equal(f!.maxLength, 255);             // …and length
  assert.equal(f!.canonical, true);            // reconciled to the canonical registry
});

test("it expands and shrinks with the connected set", () => {
  const one: SupersetInput[] = [{ broker: "n8n", system: "jira", fields: jira }];
  const two: SupersetInput[] = [...one, { broker: "n8n", system: "todoist", fields: todoist }];
  assert.equal(buildLiveSuperset(one).length, 2);
  assert.equal(buildLiveSuperset(two).length, 3);   // + todoist:title
  assert.equal(buildLiveSuperset([]).length, 0);    // no backends → nothing mappable
});

test("an exact duplicate field from one backend is de-duplicated (first wins)", () => {
  const dup = [...jira, { key: "title", label: "Summary", type: "string", sourceSystem: "jira", sourceField: "summary" }];
  assert.equal(buildLiveSuperset([{ broker: "n8n", system: "jira", fields: dup }]).filter((s) => s.canonicalKey === "title").length, 1);
});

test("fieldRefFromSuperset derives the mapping ref (home + native + superset) from a picked entry — not hand-typed", () => {
  const [j] = buildLiveSuperset([{ broker: "n8n", system: "jira", fields: jira }]);
  const ref = fieldRefFromSuperset(j!);
  assert.deepEqual(ref, { broker: "n8n", backend: "jira", field: "summary", superset: "title" });
});

test("the backend↔superset↔UI triple round-trips through the mapping importer (stored in org JSON)", () => {
  const [j] = buildLiveSuperset([{ broker: "n8n", system: "jira", fields: jira }]);
  // UI element "Title" ← superset "title" ← jira:summary — the full triple as one mapping field.
  const m = sanitizeMapping({ id: "issue", fields: { Title: fieldRefFromSuperset(j!) } });
  assert.deepEqual(m.fields["Title"], { broker: "n8n", backend: "jira", field: "summary", superset: "title" });
});

test("turning on the sidecar advertises the whole canonical vocabulary (unbounded, nullable)", () => {
  const sidecar = sidecarEnumeratedFields();
  assert.ok(sidecar.length > 20, "the sidecar exposes the full canonical set");
  assert.ok(sidecar.every((f) => f.nullable === true && f.sourceSystem === "sidecar"));
  const sup = buildLiveSuperset([{ broker: "builtin", system: "sidecar", fields: sidecar }]);
  assert.ok(sup.every((s) => s.system === "sidecar"));
  assert.ok(sup.some((s) => s.canonicalKey === "title"));
});
