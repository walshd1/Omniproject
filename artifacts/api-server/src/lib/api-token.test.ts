// Must be set BEFORE importing api-token (it parses API_TOKENS at module load). node:test isolates
// each test file in its own process, so this env is local to this file.
process.env["API_TOKENS"] = "broad-tok,scoped-tok@prog-alpha,multi-tok@prog-a|prog-b";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { matchApiToken, hasValidApiToken } from "./api-token";
import { scopeForReq } from "./rbac";

/** A request presenting `token` as a Bearer credential, with no session. */
function tokenReq(token: string): Request {
  return { headers: { authorization: `Bearer ${token}` }, signedCookies: {}, cookies: {} } as unknown as Request;
}

test("an unscoped token matches with programmes=null (broad, back-compat)", () => {
  assert.deepEqual(matchApiToken(tokenReq("broad-tok")), { programmes: null });
});

test("a programme-scoped token exposes only its programme(s)", () => {
  assert.deepEqual(matchApiToken(tokenReq("scoped-tok")), { programmes: ["prog-alpha"] });
  assert.deepEqual(matchApiToken(tokenReq("multi-tok")), { programmes: ["prog-a", "prog-b"] });
});

test("an unknown/empty token does not match", () => {
  assert.equal(matchApiToken(tokenReq("nope")), null);
  assert.equal(hasValidApiToken(tokenReq("")), false);
  assert.equal(hasValidApiToken(tokenReq("scoped-tok")), true);
});

test("scopeForReq: a scoped token resolves to programme-level scope (lateral containment)", () => {
  const s = scopeForReq(tokenReq("scoped-tok"));
  assert.equal(s.level, "programme");
  assert.deepEqual(s.programmes, ["prog-alpha"]);
});

test("scopeForReq: an unscoped token stays user-level (unchanged broad-read behaviour)", () => {
  assert.equal(scopeForReq(tokenReq("broad-tok")).level, "user");
});

test("scopeForReq: no token ⇒ user-level (no accidental elevation)", () => {
  assert.equal(scopeForReq(tokenReq("nope")).level, "user");
});
