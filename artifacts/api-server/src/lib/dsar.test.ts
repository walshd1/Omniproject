import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildDsarReport, dsarSummaryText } from "./dsar";
import { createUser, __resetScim } from "./scim";
import { record, __resetProvenance } from "./provenance";
import { revokeUserSessions, __resetKeyRegistry } from "./key-registry";

afterEach(() => { delete process.env["SCIM_TOKEN"]; __resetScim(); __resetProvenance(); __resetKeyRegistry(); });

const NOW = 1_700_000_000_000;

test("zero-at-rest subject: nothing held, but the not-retained + systems-of-record story is stated", () => {
  const r = buildDsarReport({ email: "nobody@x.io" }, NOW);
  assert.equal(r.held.scimDirectoryRecord, null);
  assert.equal(r.held.sessionsRevokedAt, null);
  assert.deepEqual(r.held.provenanceReferences, []);
  assert.ok(r.notRetained.length >= 3);
  assert.ok(r.auditEvidence.anchor); // anchor included for SIEM verification
});

test("surfaces a SCIM directory record, a revocation mark, and content-free provenance refs", () => {
  process.env["SCIM_TOKEN"] = "scim-secret-strong-012345";
  createUser({ userName: "subj@x.io", active: true });
  revokeUserSessions("subj@x.io");
  record({ callId: "c1", hop: "invoke", action: "listProjects", actor: "subj@x.io", content: { secret: "should-not-appear" } });
  record({ callId: "c1", hop: "invoke", action: "other", actor: "someone-else", content: {} });

  const r = buildDsarReport({ sub: "subj@x.io", email: "subj@x.io" }, NOW);
  assert.ok(r.held.scimDirectoryRecord, "expected the SCIM record");
  assert.match(r.held.sessionsRevokedAt ?? "", /^\d{4}-\d\d-\d\dT/); // a revocation mark is present (real time)
  assert.equal(r.held.provenanceReferences.length, 1); // only the subject's entry
  assert.equal(r.held.provenanceReferences[0]!.action, "listProjects");
  // Provenance is content-free — no request content leaks into the report.
  assert.doesNotMatch(JSON.stringify(r), /should-not-appear/);
});

test("the human summary names the subject and the held facts", () => {
  process.env["SCIM_TOKEN"] = "scim-secret-strong-012345";
  createUser({ userName: "amy@x.io", active: false });
  const r = buildDsarReport({ email: "amy@x.io" }, NOW);
  const text = dsarSummaryText(r);
  assert.match(text, /amy@x\.io/);
  assert.match(text, /SCIM directory record: yes/);
  assert.match(text, /NOT RETAINED:/);
});
