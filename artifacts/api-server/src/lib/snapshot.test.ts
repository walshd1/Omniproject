import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { canonicalJson, contentHash, buildSnapshot, verifySnapshot, manifestAnchor } from "./snapshot";

const fixed = { id: "snap-1", scope: "portfolio-financials", label: "March board pack", createdAt: "2026-03-01T00:00:00.000Z" };

test("canonicalJson is order-independent so the hash is stable", () => {
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
});

test("a captured snapshot verifies as intact", () => {
  const bundle = buildSnapshot({ ...fixed, data: [{ programme: "Platform", budget: 1000 }, { programme: "Mobile", budget: 500 }] });
  assert.equal(bundle.manifest.rowCount, 2);
  assert.equal(bundle.manifest.hashAlgorithm, "sha256");
  const v = verifySnapshot(bundle);
  assert.equal(v.ok, true);
  assert.equal(v.contentMatches, true);
});

test("ANY change to the data is detected (hash mismatch)", () => {
  const bundle = buildSnapshot({ ...fixed, data: [{ programme: "Platform", budget: 1000 }] });
  const tampered = { manifest: bundle.manifest, data: [{ programme: "Platform", budget: 9999 }] }; // edited the number
  const v = verifySnapshot(tampered);
  assert.equal(v.ok, false);
  assert.equal(v.contentMatches, false);
  assert.match(v.reason, /altered|mismatch/);
});

test("unsigned snapshot (no signing key) still proves integrity, but flags no non-repudiation", () => {
  // Tests run with SIGNING_PRIVATE_KEY unset, so signing is OFF.
  const bundle = buildSnapshot({ ...fixed, data: { total: 42 } });
  assert.equal(bundle.manifest.signature, undefined);
  const v = verifySnapshot(bundle);
  assert.equal(v.ok, true);
  assert.equal(v.signatureValid, null); // integrity-only
});

test("a signed snapshot verifies with the public key; tampering the manifest breaks the signature", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const bundle = buildSnapshot({ ...fixed, data: { total: 42 } });
  // Sign the anchor ourselves (simulating a deployment with SIGNING_PRIVATE_KEY set).
  bundle.manifest.signatureAlgorithm = "Ed25519";
  bundle.manifest.signature = crypto.sign(null, Buffer.from(manifestAnchor(bundle.manifest)), privateKey).toString("base64");

  const good = verifySnapshot(bundle, pubPem);
  assert.equal(good.ok, true);
  assert.equal(good.signatureValid, true);

  // Change a manifest field the signature covers → it no longer verifies (even though data is unchanged).
  const tampered = { ...bundle, manifest: { ...bundle.manifest, scope: "evil-rescope" } };
  const bad = verifySnapshot(tampered, pubPem);
  assert.equal(bad.ok, false);
  assert.equal(bad.signatureValid, false);
});
