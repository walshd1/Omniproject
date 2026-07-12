import { test } from "node:test";
import assert from "node:assert/strict";
import { qualifyId, qualifiedId, stampSource, fieldIdentity, parseFieldIdentity } from "./identity";
import type { Row } from "./types";

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

test("fieldIdentity is the SAME across backends for one project's field, but differs by field/broker/project", () => {
  const guid = "11111111-1111-1111-1111-111111111111";
  // Same project GUID + same broker + same source field → identical identity, regardless of which
  // backend served it. That sameness is what lets records assemble by project across backends.
  assert.equal(fieldIdentity(guid, "n8n", "duedate"), fieldIdentity(guid, "n8n", "duedate"));
  // A different field, broker, or project changes the identity.
  assert.notEqual(fieldIdentity(guid, "n8n", "duedate"), fieldIdentity(guid, "n8n", "startdate"));
  assert.notEqual(fieldIdentity(guid, "n8n", "duedate"), fieldIdentity(guid, "builtin", "duedate"));
  assert.notEqual(fieldIdentity(guid, "n8n", "duedate"), fieldIdentity("22222222-2222-2222-2222-222222222222", "n8n", "duedate"));
});

test("fieldIdentity is REVERSIBLE — every component is recoverable from the token", () => {
  const guid = "11111111-1111-1111-1111-111111111111";
  // Awkward source field (dots, colons, spaces) must survive the round-trip.
  const sourceField = "custom.field:Due Date / target";
  const token = fieldIdentity(guid, "n8n", sourceField);
  assert.deepEqual(parseFieldIdentity(token), { omniInstanceId: guid, broker: "n8n", sourceField });
  // Round-trips both ways.
  const parsed = parseFieldIdentity(token)!;
  assert.equal(fieldIdentity(parsed.omniInstanceId, parsed.broker, parsed.sourceField), token);
});

test("parseFieldIdentity rejects anything that isn't a well-formed token", () => {
  assert.equal(parseFieldIdentity("not-a-token"), null); // no dots
  assert.equal(parseFieldIdentity("a.b"), null); // only two parts
  assert.equal(parseFieldIdentity("a.b.c.d"), null); // too many parts
  assert.equal(parseFieldIdentity("!!!.!!!.!!!"), null); // non-base64url ⇒ doesn't round-trip
  assert.equal(parseFieldIdentity(123 as unknown as string), null);
});
