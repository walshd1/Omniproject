import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  verifyWebAuthnAssertion, AssertionError, registerCredential, credentialsFor, getCredential,
  revokeCredentials, issueChallenge, consumeChallenge,
} from "./passkey";

const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const RP_ID = "omniproject.example";
const ORIGIN = "https://omniproject.example";

// A P-256 keypair standing in for the approver's authenticator (the private key never leaves "the device").
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const credential = { publicKeySpki };

/** Produce exactly what `navigator.credentials.get` would hand back for a given challenge. */
function authenticatorSign(opts: { challenge: string; origin?: string; rpId?: string; uv?: boolean; up?: boolean }) {
  const clientDataBytes = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: opts.challenge, origin: opts.origin ?? ORIGIN, crossOrigin: false }));
  let flags = 0;
  if (opts.up ?? true) flags |= 0x01;
  if (opts.uv ?? true) flags |= 0x04;
  const authData = Buffer.concat([sha256(Buffer.from(opts.rpId ?? RP_ID)), Buffer.from([flags]), Buffer.alloc(4)]);
  const signatureBase = Buffer.concat([authData, sha256(clientDataBytes)]);
  const signature = crypto.sign("sha256", signatureBase, privateKey); // DER by default for EC
  return { clientDataJSON: clientDataBytes.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url") };
}

const base = (challenge: string) => ({ credential, expectedChallenge: challenge, rpId: RP_ID, origin: ORIGIN });

test("a valid assertion verifies and yields a sigRef", () => {
  const a = authenticatorSign({ challenge: "chal-123" });
  const r = verifyWebAuthnAssertion({ ...base("chal-123"), ...a });
  assert.equal(r.ok, true);
  assert.ok(r.sigRef.length > 0);
});

test("a replayed / wrong challenge is rejected", () => {
  const a = authenticatorSign({ challenge: "chal-A" });
  assert.throws(() => verifyWebAuthnAssertion({ ...base("chal-B"), ...a }), /challenge mismatch/);
});

test("a wrong origin is rejected", () => {
  const a = authenticatorSign({ challenge: "c", origin: "https://evil.example" });
  assert.throws(() => verifyWebAuthnAssertion({ ...base("c"), ...a }), /origin mismatch/);
});

test("a wrong rpId (rpIdHash) is rejected", () => {
  const a = authenticatorSign({ challenge: "c", rpId: "other.example" });
  assert.throws(() => verifyWebAuthnAssertion({ ...base("c"), ...a }), /rpIdHash mismatch/);
});

test("a tampered signature does not verify", () => {
  const a = authenticatorSign({ challenge: "c" });
  const bad = Buffer.from(a.signature, "base64url"); bad[0] = (bad[0] ?? 0) ^ 0xff;
  assert.throws(() => verifyWebAuthnAssertion({ ...base("c"), ...a, signature: bad.toString("base64url") }), /signature does not verify/);
});

test("user-verification is required by default", () => {
  const a = authenticatorSign({ challenge: "c", uv: false });
  assert.throws(() => verifyWebAuthnAssertion({ ...base("c"), ...a }), /user-verification required/);
  // …but can be relaxed to user-presence only.
  const r = verifyWebAuthnAssertion({ ...base("c"), ...a, requireUserVerification: false });
  assert.equal(r.ok, true);
});

test("user-present must be set", () => {
  const a = authenticatorSign({ challenge: "c", up: false, uv: false });
  assert.throws(() => verifyWebAuthnAssertion({ ...base("c"), ...a, requireUserVerification: false }), /user-present/);
});

test("credential store: register, list, get, revoke (offboarding)", async () => {
  const sub = "user-42";
  await registerCredential(sub, { credentialId: "cred-1", publicKeySpki });
  assert.equal((await credentialsFor(sub)).length, 1);
  assert.equal((await getCredential(sub, "cred-1"))?.credentialId, "cred-1");
  // registering a garbage key is refused
  await assert.rejects(() => registerCredential(sub, { credentialId: "bad", publicKeySpki: "not-a-key" }), AssertionError);
  // revoke wipes them — the offboarding hook
  await revokeCredentials(sub);
  assert.deepEqual(await credentialsFor(sub), []);
});

test("revokeAllCredentials wipes every user's passkeys (admin/PMO emergency reset)", async () => {
  const { revokeAllCredentials } = await import("./passkey");
  await registerCredential("mass-a", { credentialId: "a1", publicKeySpki });
  await registerCredential("mass-b", { credentialId: "b1", publicKeySpki });
  const n = await revokeAllCredentials();
  assert.ok(n >= 2);
  assert.deepEqual(await credentialsFor("mass-a"), []);
  assert.deepEqual(await credentialsFor("mass-b"), []);
});

test("challenge is one-time: consume succeeds once, then fails; a wrong value never matches", async () => {
  const scope = "prop-1:s1";
  const challenge = await issueChallenge(scope, "content-hash-abc");
  assert.equal(await consumeChallenge(scope, "wrong"), false);
  assert.equal(await consumeChallenge(scope, challenge), true);
  assert.equal(await consumeChallenge(scope, challenge), false); // already consumed
});
