import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Request, Response } from "express";
import {
  signLicense,
  verifyLicense,
  resolveLicense,
  isEntitled,
  licenseSummary,
  requireEntitlement,
  LICENSE_FEATURES,
  type LicensePayload,
} from "./license";

/**
 * Licensing / entitlements. The pre-community default grants everything; setting
 * PREMIUM_ENFORCEMENT=on restores the paywall and exercises the sign/verify machinery.
 */
const ENV_KEYS = ["PREMIUM_ENFORCEMENT", "LICENSE_KEY", "LICENSE_PUBLIC_KEY", "LICENSE_DEV_FEATURES", "NODE_ENV"];
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

function keypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const basePayload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  customer: "Acme",
  tier: "enterprise",
  features: ["branding", "labels"],
  iat: Math.floor(Date.now() / 1000),
  ...over,
});

test("pre-community (default): every feature is granted without a key", () => {
  const status = resolveLicense();
  assert.equal(status.source, "pre-community");
  assert.equal(status.valid, true);
  assert.deepEqual([...status.features].sort(), [...LICENSE_FEATURES].sort());
  assert.equal(isEntitled("webhooks"), true);
});

test("licenseSummary exposes the full feature catalog", () => {
  const s = licenseSummary();
  assert.deepEqual([...s.catalog].sort(), [...LICENSE_FEATURES].sort());
});

test("enforcement on + valid signed licence → source 'license' with only its features", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  process.env["LICENSE_PUBLIC_KEY"] = publicKeyPem;
  const future = Math.floor(Date.now() / 1000) + 3600;
  process.env["LICENSE_KEY"] = signLicense(basePayload({ exp: future, features: ["labels"] }), privateKeyPem);

  const status = resolveLicense();
  assert.equal(status.source, "license");
  assert.equal(status.valid, true);
  assert.equal(status.tier, "enterprise");
  assert.equal(status.customer, "Acme");
  assert.deepEqual(status.features, ["labels"]);
  assert.ok(status.expiresAt);
  assert.ok(typeof status.expiresInDays === "number");
  assert.equal(isEntitled("labels"), true);
  assert.equal(isEntitled("webhooks"), false);
});

test("enforcement on + valid licence with NO exp → never expires, null expiry fields", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  process.env["LICENSE_PUBLIC_KEY"] = publicKeyPem;
  process.env["LICENSE_KEY"] = signLicense(basePayload(), privateKeyPem);
  const status = resolveLicense();
  assert.equal(status.valid, true);
  assert.equal(status.expiresAt, null);
  assert.equal(status.expiresInDays, null);
});

test("enforcement on + expired licence → invalid, reason 'licence expired'", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  process.env["LICENSE_PUBLIC_KEY"] = publicKeyPem;
  const past = Math.floor(Date.now() / 1000) - 10;
  process.env["LICENSE_KEY"] = signLicense(basePayload({ exp: past }), privateKeyPem);
  const status = resolveLicense();
  assert.equal(status.valid, false);
  assert.equal(status.source, "none");
  assert.match(status.reason ?? "", /expired/);
});

test("enforcement on + LICENSE_KEY but no public key → reported reason, no features", () => {
  const { privateKeyPem } = keypair();
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  process.env["LICENSE_KEY"] = signLicense(basePayload(), privateKeyPem);
  const status = resolveLicense();
  assert.equal(status.source, "none");
  assert.match(status.reason ?? "", /no LICENSE_PUBLIC_KEY/);
});

test("enforcement on + no licence at all → source 'none'", () => {
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  const status = resolveLicense();
  assert.equal(status.source, "none");
  assert.equal(status.valid, false);
  assert.deepEqual(status.features, []);
  assert.match(status.reason ?? "", /no licence configured/);
});

test("dev features (non-production) grant when no licence: explicit list and 'all'", () => {
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  process.env["LICENSE_DEV_FEATURES"] = "labels, webhooks";
  let status = resolveLicense();
  assert.equal(status.source, "dev");
  assert.deepEqual([...status.features].sort(), ["labels", "webhooks"]);

  process.env["LICENSE_DEV_FEATURES"] = "all";
  status = resolveLicense();
  assert.equal(status.source, "dev");
  assert.deepEqual([...status.features].sort(), [...LICENSE_FEATURES].sort());
});

test("dev features are ignored in production", () => {
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  process.env["NODE_ENV"] = "production";
  process.env["LICENSE_DEV_FEATURES"] = "all";
  const status = resolveLicense();
  assert.equal(status.source, "none");
  assert.deepEqual(status.features, []);
});

test("invalid licence but dev features present → source 'dev' carrying the invalid reason", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  process.env["LICENSE_PUBLIC_KEY"] = publicKeyPem;
  process.env["LICENSE_KEY"] = signLicense(basePayload({ exp: Math.floor(Date.now() / 1000) - 5 }), privateKeyPem);
  process.env["LICENSE_DEV_FEATURES"] = "branding";
  const status = resolveLicense();
  assert.equal(status.source, "dev");
  assert.deepEqual(status.features, ["branding"]);
  assert.match(status.reason ?? "", /expired/);
});

test("verifyLicense: malformed token, wrong public key, bad signature, unreadable payload", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  const token = signLicense(basePayload(), privateKeyPem);

  assert.equal(verifyLicense("not-a-token", publicKeyPem).reason, "malformed licence token");
  assert.equal(verifyLicense("a.b.c.d", publicKeyPem).reason, "malformed licence token");

  assert.match(verifyLicense(token, "not a pem").reason ?? "", /invalid licence public key/);

  // A different keypair's public key → signature verification fails.
  const other = keypair();
  assert.match(verifyLicense(token, other.publicKeyPem).reason ?? "", /signature verification failed/);

  // Valid prefix + valid signature over a non-JSON body → unreadable payload.
  const badBody = Buffer.from("{not json", "utf8").toString("base64url");
  const signingInput = `omni-lic.v1.${badBody}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(signingInput), key).toString("base64url");
  assert.match(verifyLicense(`${signingInput}.${sig}`, publicKeyPem).reason ?? "", /unreadable licence payload/);
});

test("verifyLicense: valid token round-trips the payload", () => {
  const { publicKeyPem, privateKeyPem } = keypair();
  const payload = basePayload();
  const token = signLicense(payload, privateKeyPem);
  const result = verifyLicense(token, publicKeyPem);
  assert.equal(result.valid, true);
  assert.equal(result.reason, null);
  assert.equal(result.payload?.customer, "Acme");
});

test("requireEntitlement: allows when entitled, 402s when not", () => {
  // Pre-community: entitled → next() called.
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  const okRes = { status() { throw new Error("should not respond"); } } as unknown as Response;
  requireEntitlement("labels")({} as Request, okRes, next);
  assert.equal(nextCalled, true);

  // Enforced with no licence → 402.
  process.env["PREMIUM_ENFORCEMENT"] = "on";
  let statusCode = 0;
  let payload: unknown = null;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { payload = body; return this; },
  } as unknown as Response;
  let denyNextCalled = false;
  requireEntitlement("labels")({} as Request, res, () => { denyNextCalled = true; });
  assert.equal(statusCode, 402);
  assert.equal(denyNextCalled, false);
  assert.equal((payload as { feature?: string }).feature, "labels");
});
