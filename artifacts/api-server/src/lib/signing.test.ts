import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Configure an Ed25519 signing key BEFORE importing the modules that read it at load time,
// so non-repudiation signing is enabled for this whole file (node:test isolates per file).
const kp = crypto.generateKeyPairSync("ed25519");
const PRIVATE_PEM = kp.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const PUBLIC_PEM = kp.publicKey.export({ format: "pem", type: "spki" }).toString();
process.env["SIGNING_PRIVATE_KEY"] = PRIVATE_PEM;

const { parsePrivateKey, signingEnabled, publicKeyPem, publicKeyId, signMessage, verifySignature, signingInfo } =
  await import("./signing");
const { sealAuditEvent, auditAnchor, verifyAuditAnchor, __resetAuditChain } = await import("./audit-chain");
const { record, provenanceAnchor, verifyProvenanceAnchor, __resetProvenance } = await import("./provenance");
const { __resetKeyRegistry } = await import("./key-registry");

afterEach(() => { __resetAuditChain(); __resetProvenance(); __resetKeyRegistry(); });

// ── Key parsing (pure; all accepted formats + the failure path) ──────────────────
test("parsePrivateKey accepts PEM, base64 PKCS#8 DER, and a base64 32-byte seed", () => {
  const der = kp.privateKey.export({ format: "der", type: "pkcs8" });
  const seed = kp.privateKey.export({ format: "jwk" }).d!; // base64url 32-byte seed
  const seedB64 = Buffer.from(seed, "base64url").toString("base64");
  for (const raw of [PRIVATE_PEM, der.toString("base64"), seedB64]) {
    const key = parsePrivateKey(raw);
    assert.ok(key, "expected a key object");
    // Every format must derive the SAME public key as the original pair.
    const pub = crypto.createPublicKey(key!.export({ format: "pem", type: "pkcs8" })).export({ format: "pem", type: "spki" }).toString();
    assert.equal(pub, PUBLIC_PEM);
  }
});

test("parsePrivateKey returns null on empty or garbage input", () => {
  assert.equal(parsePrivateKey(""), null);
  assert.equal(parsePrivateKey("   "), null);
  assert.equal(parsePrivateKey("not-a-key-at-all-$$$"), null);
});

// ── Sign / verify primitives ─────────────────────────────────────────────────────
test("signing is enabled and publishes a stable public key + id", () => {
  assert.equal(signingEnabled(), true);
  assert.equal(publicKeyPem(), PUBLIC_PEM);
  assert.match(publicKeyId()!, /^[0-9a-f]{16}$/);
  const info = signingInfo();
  assert.deepEqual({ enabled: info.enabled, algorithm: info.algorithm }, { enabled: true, algorithm: "Ed25519" });
});

test("a signature round-trips and rejects tamper / wrong key", () => {
  const sig = signMessage("hello")!;
  assert.ok(sig);
  assert.equal(verifySignature("hello", sig, PUBLIC_PEM), true);
  assert.equal(verifySignature("hell0", sig, PUBLIC_PEM), false); // message tampered
  const other = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
  assert.equal(verifySignature("hello", sig, other), false); // wrong key
  assert.equal(verifySignature("hello", "not-base64-sig!!", PUBLIC_PEM), false); // junk signature
});

// ── Signed audit anchor (non-repudiation over the chain tip) ─────────────────────
test("the audit anchor is Ed25519-signed and verifies against the published key", () => {
  sealAuditEvent({ ts: "2026-06-28T00:00:00Z", category: "admin", action: "a", write: true });
  const anchor = auditAnchor();
  assert.equal(anchor.signatureAlgorithm, "Ed25519");
  assert.equal(anchor.publicKeyId, publicKeyId());
  assert.ok(anchor.signature);
  assert.equal(verifyAuditAnchor(anchor, PUBLIC_PEM), true);
});

test("a forged audit tip fails signature verification", () => {
  sealAuditEvent({ ts: "2026-06-28T00:00:00Z", category: "admin", action: "a", write: true });
  const anchor = auditAnchor();
  assert.equal(verifyAuditAnchor({ ...anchor, lastHash: "deadbeef".repeat(8) }, PUBLIC_PEM), false);
});

// ── Signed provenance anchor ─────────────────────────────────────────────────────
test("the provenance anchor is Ed25519-signed and verifies; a moved tip fails", () => {
  record({ callId: "c1", hop: "invoke", action: "listProjects", actor: "u1", content: { a: 1 } });
  const anchor = provenanceAnchor();
  assert.equal(anchor.signatureAlgorithm, "Ed25519");
  assert.ok(anchor.signature);
  assert.equal(verifyProvenanceAnchor(anchor, PUBLIC_PEM), true);
  assert.equal(verifyProvenanceAnchor({ ...anchor, seq: anchor.seq + 5 }, PUBLIC_PEM), false);
});
