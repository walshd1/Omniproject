import { test } from "node:test";
import assert from "node:assert/strict";
import { idTokenNonce, decodeIdTokenClaims } from "./oidc";

/** Build a JWT-shaped string (header.payload.signature) with the given payload. */
function fakeIdToken(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

test("idTokenNonce reads the nonce claim from a token payload", () => {
  const token = fakeIdToken({ sub: "u1", nonce: "abc123" });
  assert.equal(idTokenNonce(token), "abc123");
});

test("idTokenNonce returns null when the nonce is absent or non-string", () => {
  assert.equal(idTokenNonce(fakeIdToken({ sub: "u1" })), null);
  assert.equal(idTokenNonce(fakeIdToken({ sub: "u1", nonce: 42 })), null);
});

test("idTokenNonce returns null for a malformed token", () => {
  assert.equal(idTokenNonce("not-a-jwt"), null);
  assert.equal(idTokenNonce("a.b"), null);
  assert.equal(idTokenNonce(`${Buffer.from("x").toString("base64url")}.%%%.sig`), null);
});

test("a round-trip nonce matches and a different flow's nonce does not (replay rejected)", () => {
  const minted = "flow-nonce-xyz";
  const token = fakeIdToken({ sub: "u1", nonce: minted });
  assert.equal(idTokenNonce(token) === minted, true); // same flow → accepted
  assert.equal(idTokenNonce(token) === "some-other-flow-nonce", false); // replayed → rejected
});

test("nonce extraction is independent of the user-claim decode", () => {
  // The two decoders read the same payload but serve different purposes.
  const token = fakeIdToken({ sub: "u1", email: "a@b.c", name: "A", nonce: "n1" });
  assert.equal(idTokenNonce(token), "n1");
  assert.equal(decodeIdTokenClaims(token)?.sub, "u1");
});
