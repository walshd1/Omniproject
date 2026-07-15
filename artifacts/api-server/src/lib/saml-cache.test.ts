import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { samlCacheProvider, replayProtection } from "./saml";

/**
 * Unit tests for the node-saml CacheProvider adapter in isolation (over the real shared-state
 * seam, in-memory in tests). The node-saml *integration* (validateInResponseTo binding requests
 * to responses) is not exercised here because @node-saml/node-saml is a runtime-optional dep that
 * isn't installed — that path needs an integration test with the library present.
 */

test("samlCacheProvider: save → get → remove round-trip", async () => {
  const cp = samlCacheProvider();
  const key = `t-${crypto.randomUUID()}`;
  assert.equal(await cp.getAsync(key), null); // missing ⇒ null
  const saved = await cp.saveAsync(key, "val-1");
  assert.equal(saved?.value, "val-1");
  assert.equal(typeof saved?.createdAt, "number");
  assert.equal(await cp.getAsync(key), "val-1");
  assert.equal(await cp.removeAsync(key), key);
  assert.equal(await cp.getAsync(key), null); // consumed
});

test("samlCacheProvider: saveAsync never overwrites an existing key (returns null)", async () => {
  const cp = samlCacheProvider();
  const key = `t-${crypto.randomUUID()}`;
  await cp.saveAsync(key, "first");
  assert.equal(await cp.saveAsync(key, "second"), null); // node-saml semantics: no overwrite
  assert.equal(await cp.getAsync(key), "first");
  await cp.removeAsync(key);
});

test("replayProtection defaults to 'ifPresent' single-replica (no REDIS_URL) — protects SP-initiated, safe for IdP-initiated", () => {
  // Test env has no REDIS_URL ⇒ single-replica: redirect + ACS share a process, so the in-memory cache is
  // correct. "ifPresent" validates an InResponseTo when the response carries one without fail-closing an
  // IdP-initiated response that has none. (The unsafe multi-replica-no-Redis window is covered separately.)
  delete process.env["REDIS_URL"];
  assert.equal(replayProtection()["validateInResponseTo"], "ifPresent");
});

test("SAML_STRICT_REPLAY opts a single-replica deploy into validateInResponseTo (in-memory cache)", () => {
  process.env["SAML_STRICT_REPLAY"] = "1";
  try {
    const opts = replayProtection();
    assert.equal(opts["validateInResponseTo"], "always");
    assert.ok(opts["cacheProvider"], "an (in-memory) cache provider is supplied");
  } finally {
    delete process.env["SAML_STRICT_REPLAY"];
  }
});
