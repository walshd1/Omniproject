import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildSignedRelease, canonicalManifest, verifyReleaseProvenance, enforceReleaseProvenanceAtBoot,
  releaseVerifyMode, parseSignedRelease, type ReleaseManifest,
  buildSignedPromotion, verifyPromotion, parseSignedPromotion, admitBuild, type PromotionRecord,
} from "./release-provenance";

/**
 * Release provenance — sign a build manifest with a release private key; verify at boot against the trusted
 * public key. Fail-closed under strict, off by default. (docs/UPDATE-MECHANISM.md §4, phase 1.)
 */

function keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    pubPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

const MANIFEST: ReleaseManifest = { version: "1.2.3", gitSha: "abc123", builtAt: "2026-07-24T00:00:00Z", digest: "sha256:deadbeef" };

/** An env with a signed release baked inline + the trusted key + a mode. */
function env(mode: string, over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { RELEASE_VERIFY: mode, RELEASE_MANIFEST_FILE: "/nonexistent/release.json", ...over };
}

test("releaseVerifyMode defaults to off and reads strict/warn", () => {
  assert.equal(releaseVerifyMode({}), "off");
  assert.equal(releaseVerifyMode({ RELEASE_VERIFY: "strict" }), "strict");
  assert.equal(releaseVerifyMode({ RELEASE_VERIFY: "warn" }), "warn");
  assert.equal(releaseVerifyMode({ RELEASE_VERIFY: "bogus" }), "off");
});

test("canonicalManifest is key-order independent (signing == verifying byte-for-byte)", () => {
  const a = canonicalManifest({ version: "1", gitSha: "s", builtAt: "t", digest: "d" });
  const b = canonicalManifest({ digest: "d", builtAt: "t", gitSha: "s", version: "1" } as ReleaseManifest);
  assert.equal(a, b);
});

test("a correctly-signed build verifies under strict", () => {
  const { privPem, pubPem } = keypair();
  const signed = buildSignedRelease(MANIFEST, privPem)!;
  assert.ok(signed && signed.signature && signed.keyId);
  const r = verifyReleaseProvenance(env("strict", { RELEASE_PUBLIC_KEY: pubPem, RELEASE_MANIFEST: JSON.stringify(signed) }));
  assert.equal(r.ok, true);
  assert.equal(r.manifest?.version, "1.2.3");
});

test("a tampered manifest fails verification", () => {
  const { privPem, pubPem } = keypair();
  const signed = buildSignedRelease(MANIFEST, privPem)!;
  signed.manifest.version = "9.9.9"; // tamper AFTER signing
  const r = verifyReleaseProvenance(env("strict", { RELEASE_PUBLIC_KEY: pubPem, RELEASE_MANIFEST: JSON.stringify(signed) }));
  assert.equal(r.ok, false);
  assert.match(r.reason!, /signature does not verify/);
});

test("a signature from a different key fails (wrong trust root)", () => {
  const { privPem } = keypair();
  const other = keypair();
  const signed = buildSignedRelease(MANIFEST, privPem)!;
  const r = verifyReleaseProvenance(env("strict", { RELEASE_PUBLIC_KEY: other.pubPem, RELEASE_MANIFEST: JSON.stringify(signed) }));
  assert.equal(r.ok, false);
});

test("missing manifest / missing key are failures under strict", () => {
  const { pubPem } = keypair();
  assert.match(verifyReleaseProvenance(env("strict", { RELEASE_PUBLIC_KEY: pubPem })).reason!, /no signed release manifest/);
  const { privPem } = keypair();
  const signed = buildSignedRelease(MANIFEST, privPem)!;
  assert.match(verifyReleaseProvenance(env("strict", { RELEASE_MANIFEST: JSON.stringify(signed) })).reason!, /no RELEASE_PUBLIC_KEY/);
});

test("mode off is always a pass (unchanged boot), even with no manifest", () => {
  const r = verifyReleaseProvenance({ RELEASE_MANIFEST_FILE: "/nonexistent/release.json" });
  assert.deepEqual(r, { ok: true, mode: "off" });
});

test("parseSignedRelease drops malformed input", () => {
  assert.equal(parseSignedRelease(null), null);
  assert.equal(parseSignedRelease({ manifest: { version: "1" }, signature: "x" }), null); // missing gitSha/builtAt
  assert.equal(parseSignedRelease({ manifest: MANIFEST }), null); // missing signature
  assert.ok(parseSignedRelease({ manifest: MANIFEST, signature: "x" }));
});

// ── Phase 2: promote-by-digest + admission ──────────────────────────────────────────────────────────────

test("promote-by-digest: a matching approved digest is admitted; a mismatch is refused", () => {
  const { privPem, pubPem } = keypair();
  const signed = buildSignedRelease(MANIFEST, privPem)!; // digest sha256:deadbeef
  const base = { RELEASE_VERIFY: "strict", RELEASE_MANIFEST_FILE: "/nonexistent", RELEASE_PUBLIC_KEY: pubPem, RELEASE_MANIFEST: JSON.stringify(signed) };
  assert.equal(verifyReleaseProvenance({ ...base, RELEASE_EXPECTED_DIGEST: "sha256:deadbeef" }).ok, true);
  const bad = verifyReleaseProvenance({ ...base, RELEASE_EXPECTED_DIGEST: "sha256:0ther" });
  assert.equal(bad.ok, false);
  assert.match(bad.reason!, /not the approved digest/);
});

test("promote-by-digest: an expected digest is pinned but the build carries none → refused", () => {
  const { privPem, pubPem } = keypair();
  const noDigest = buildSignedRelease({ version: "1", gitSha: "s", builtAt: "t" }, privPem)!;
  const r = verifyReleaseProvenance({ RELEASE_VERIFY: "strict", RELEASE_MANIFEST_FILE: "/nonexistent", RELEASE_PUBLIC_KEY: pubPem, RELEASE_MANIFEST: JSON.stringify(noDigest), RELEASE_EXPECTED_DIGEST: "sha256:deadbeef" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /carries none/);
});

test("promotion record signs + verifies; a tampered digest fails", () => {
  const { privPem, pubPem } = keypair();
  const rec: PromotionRecord = { digest: "sha256:deadbeef", promotedAt: "2026-07-24T00:00:00Z", note: "org accepted" };
  const signed = buildSignedPromotion(rec, privPem)!;
  assert.equal(verifyPromotion(signed, pubPem), true);
  signed.record.digest = "sha256:evil";
  assert.equal(verifyPromotion(signed, pubPem), false);
});

test("admitBuild: admits only when both signatures verify AND the digests match", () => {
  const { privPem, pubPem } = keypair();
  const manifest = buildSignedRelease(MANIFEST, privPem)!;                                   // digest sha256:deadbeef
  const promo = buildSignedPromotion({ digest: "sha256:deadbeef", promotedAt: "t" }, privPem)!;
  assert.equal(admitBuild(manifest, promo, pubPem).admitted, true);

  // digest mismatch → denied
  const otherPromo = buildSignedPromotion({ digest: "sha256:other", promotedAt: "t" }, privPem)!;
  const denied = admitBuild(manifest, otherPromo, pubPem);
  assert.equal(denied.admitted, false);
  assert.match(denied.reason!, /not the promoted digest/);

  // wrong trust root → denied (manifest sig fails against a foreign key)
  assert.equal(admitBuild(manifest, promo, keypair().pubPem).admitted, false);

  // build with no digest → denied
  const noDigest = buildSignedRelease({ version: "1", gitSha: "s", builtAt: "t" }, privPem)!;
  assert.equal(admitBuild(noDigest, promo, pubPem).admitted, false);
});

test("parseSignedPromotion drops malformed input", () => {
  assert.equal(parseSignedPromotion({ record: { digest: "d" }, signature: "x" }), null); // missing promotedAt
  assert.equal(parseSignedPromotion({ record: { digest: "d", promotedAt: "t" } }), null); // missing signature
  assert.ok(parseSignedPromotion({ record: { digest: "d", promotedAt: "t" }, signature: "x" }));
});

test("boot gate: strict + failure refuses to run (fail-closed); warn + ok never exit", () => {
  const { privPem, pubPem } = keypair();
  const signed = buildSignedRelease(MANIFEST, privPem)!;

  // strict + bad signature → exit(1)
  let exited: number | null = null;
  const exit = ((code: number) => { exited = code; throw new Error("exited"); }) as (code: number) => never;
  const bad = env("strict", { RELEASE_PUBLIC_KEY: keypair().pubPem, RELEASE_MANIFEST: JSON.stringify(signed) });
  assert.throws(() => enforceReleaseProvenanceAtBoot(bad, exit), /exited/);
  assert.equal(exited, 1);

  // strict + good → no exit
  exited = null;
  const good = env("strict", { RELEASE_PUBLIC_KEY: pubPem, RELEASE_MANIFEST: JSON.stringify(signed) });
  assert.equal(enforceReleaseProvenanceAtBoot(good, exit).ok, true);
  assert.equal(exited, null);

  // warn + bad → continue (no exit), ok:false
  exited = null;
  const warn = env("warn", { RELEASE_PUBLIC_KEY: keypair().pubPem, RELEASE_MANIFEST: JSON.stringify(signed) });
  assert.equal(enforceReleaseProvenanceAtBoot(warn, exit).ok, false);
  assert.equal(exited, null);
});
