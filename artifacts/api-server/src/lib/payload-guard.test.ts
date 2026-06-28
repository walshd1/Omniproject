import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeBrokerPayload, assertSafeIdentifier, assertSafeAuthHeader } from "./payload-guard";
import { BrokerError } from "../broker/types";

/**
 * Egress injection guard: control characters and URL-structural id characters are
 * rejected before anything leaves the gateway.
 */
test("clean payloads pass", () => {
  assert.doesNotThrow(() => assertSafeBrokerPayload({ projectId: "PROJ-123", title: "Hello, world.", nested: { issueId: "ISSUE_9" } }));
  assert.doesNotThrow(() => assertSafeBrokerPayload({ tags: ["a", "b-c", "d.e"] }));
});

test("a control character anywhere is rejected (CRLF/NUL injection)", () => {
  assert.throws(() => assertSafeBrokerPayload({ title: "line1\r\nInjected: header" }), BrokerError);
  assert.throws(() => assertSafeBrokerPayload({ note: "a\u0000b" }), BrokerError);
  assert.throws(() => assertSafeBrokerPayload({ deep: { list: ["ok", "bad\nvalue"] } }), BrokerError);
});

test("identifier fields reject URL-structural characters (path/query injection)", () => {
  for (const bad of ["../admin", "a/b", "id?x=1", "p#frag", "a&b", "a%2e", "a b"]) {
    assert.throws(() => assertSafeBrokerPayload({ projectId: bad }), BrokerError, `should reject ${bad}`);
  }
  assert.throws(() => assertSafeIdentifier("issueId", "1/2"), BrokerError);
});

test("non-identifier free-text may contain slashes and punctuation", () => {
  // `title` is not an id, so a slash is fine — only control chars are barred there.
  assert.doesNotThrow(() => assertSafeBrokerPayload({ title: "Q3 plan: a/b testing (50% done)" }));
});

test("the forwarded auth header rejects control characters", () => {
  assert.doesNotThrow(() => assertSafeAuthHeader("Bearer abc.def.ghi"));
  assert.doesNotThrow(() => assertSafeAuthHeader(undefined));
  assert.throws(() => assertSafeAuthHeader("Bearer x\r\nX-Inject: 1"), BrokerError);
});

test("the thrown error is a 400 bad_request", () => {
  try { assertSafeIdentifier("projectId", "a/b"); assert.fail("should throw"); }
  catch (e) { assert.ok(e instanceof BrokerError); assert.equal(e.status, 400); }
});
