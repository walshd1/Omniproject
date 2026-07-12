import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifyId, qualifiedId, stampSource, fieldIdentity, parseFieldIdentity, matchIdentityComponent, type FieldIdentityParts } from "./identity";
import type { Row } from "./types";

const parts = (over: Partial<FieldIdentityParts> = {}): FieldIdentityParts => ({
  omniInstanceId: "11111111-1111-1111-1111-111111111111",
  vendor: "jira",
  broker: "n8n",
  sourceField: "duedate",
  ...over,
});

test("qualifyId builds a source-qualified key, falling back to the raw id when no source", () => {
  assert.equal(qualifyId("jira", "proj-1"), "jira:proj-1");
  assert.equal(qualifyId("", "proj-1"), "proj-1");
  assert.equal(qualifyId(null, "proj-1"), "proj-1");
});

test("two backends minting the same id stay distinct once qualified", () => {
  const a: Row = { id: "100", name: "Migration", source: "jira" };
  const b: Row = { id: "100", name: "Migration", source: "azure-devops" };
  assert.notEqual(qualifiedId(a), qualifiedId(b)); // same id + same name, different source → distinct
  assert.equal(qualifiedId(a), "jira:100");
});

test("qualifiedId uses a fallback source when the row omitted one", () => {
  assert.equal(qualifiedId({ id: "7" } as Row, "plane"), "plane:7");
});

test("stampSource fills source only where missing, leaving backend-supplied source intact", () => {
  const rows: Row[] = [{ id: "1" }, { id: "2", source: "jira" }, { id: "3", source: "" }];
  stampSource(rows, "plane");
  assert.equal(rows[0]!["source"], "plane"); // was missing → stamped
  assert.equal(rows[1]!["source"], "jira"); // already set → untouched
  assert.equal(rows[2]!["source"], "plane"); // empty string → stamped
});

test("fieldIdentity is a SET of per-component ciphertext pieces, deterministic and opaque", () => {
  const id = fieldIdentity(parts());
  // Four pieces — one per component.
  assert.deepEqual(Object.keys(id).sort(), ["broker", "field", "project", "vendor"]);
  // Deterministic: the same wiring + project yields identical pieces (so they can be matched).
  assert.deepEqual(fieldIdentity(parts()), id);
  // Opaque: no piece leaks its plaintext.
  assert.doesNotMatch(id.field, /duedate/);
  assert.doesNotMatch(id.project, /1111/);
  // Distinct components never share a piece, even for equal underlying values.
  const same = fieldIdentity(parts({ vendor: "x", broker: "x", sourceField: "x", omniInstanceId: "x" }));
  assert.equal(new Set([same.project, same.vendor, same.broker, same.field]).size, 4);
});

test("each piece changes when its component changes; others stay put (built from the wiring)", () => {
  const base = fieldIdentity(parts());
  const otherField = fieldIdentity(parts({ sourceField: "startdate" }));
  assert.notEqual(base.field, otherField.field); // field piece changed
  assert.equal(base.project, otherField.project); // project piece unchanged
  assert.notEqual(base.project, fieldIdentity(parts({ omniInstanceId: "22222222-2222-2222-2222-222222222222" })).project);
});

test("fieldIdentity is REVERSIBLE — every component decrypts back, incl. awkward field names", () => {
  const p = parts({ sourceField: "custom.field:Due Date / target" });
  const id = fieldIdentity(p);
  assert.deepEqual(parseFieldIdentity(id), p);
});

test("parseFieldIdentity rejects a missing/tampered/mismatched identity", () => {
  const id = fieldIdentity(parts());
  assert.equal(parseFieldIdentity(null), null);
  assert.equal(parseFieldIdentity({ ...id, field: "not-a-piece" }), null); // tampered piece
  assert.equal(parseFieldIdentity({ ...id, project: id.vendor }), null); // wrong-component piece (AAD mismatch)
});

test("matchIdentityComponent matches a piece against a candidate value (the lookup primitive)", () => {
  const id = fieldIdentity(parts());
  assert.equal(matchIdentityComponent(id.project, "project", "11111111-1111-1111-1111-111111111111"), true);
  assert.equal(matchIdentityComponent(id.project, "project", "99999999-9999-9999-9999-999999999999"), false);
  assert.equal(matchIdentityComponent(id.field, "field", "duedate"), true);
  // A value that matches one component must not match under a different component label.
  assert.equal(matchIdentityComponent(id.project, "vendor", "11111111-1111-1111-1111-111111111111"), false);
});
