import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * Passkey STEP-UP over the REAL app: enrol a passkey, challenge, sign a WebAuthn assertion, and verify the
 * session is upgraded to strong auth (so `/auth/me` reports strongAuth true). This is the mechanism that lets a
 * local password admin (amr:["pwd"], not strong) unlock admin/PMO when LOCAL_ADMIN_REQUIRE_PASSKEY is on.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
process.env["CSRF_DISABLED"] = "true";
process.env["WEBAUTHN_RP_ID"] = "localhost";
process.env["WEBAUTHN_ORIGIN"] = "https://localhost";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "passkey-stepup-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const RP_ID = "localhost";
const ORIGIN = "https://localhost";
const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

/** Exactly what navigator.credentials.get would return for a challenge (user-present + user-verified). */
function authenticatorSign(challenge: string) {
  const clientDataBytes = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]); // UP|UV flags
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientDataBytes)]), privateKey);
  return { clientDataJSON: clientDataBytes.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url") };
}

let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();
function cookiesFrom(r: Response): string {
  const set = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  // A response may set the same cookie twice (slideSession re-stamps the session, then the route re-issues it);
  // a browser keeps the LAST value per name, so mirror that (last-wins) rather than concatenating duplicates.
  const byName = new Map<string, string>();
  for (const c of set) { const kv = c.split(";")[0]!; byName.set(kv.slice(0, kv.indexOf("=")), kv); }
  return [...byName.values()].join("; ");
}

test("step-up challenge is refused until a passkey is enrolled", async () => {
  const r = await h.req("/auth/passkey/step-up/challenge", { method: "POST", cookie: ADMIN });
  assert.equal(r.status, 409);
  assert.equal((await json(r)).needsEnrolment, true);
});

test("enrol → challenge → assertion upgrades the session to strong auth", async () => {
  // Enrol a passkey for this session (reuses the approvals passkey store).
  const reg = await h.req("/approvals/passkey", { method: "POST", cookie: ADMIN, body: { credentialId: "cred-1", publicKeySpki } });
  assert.ok(reg.ok, `passkey enrol failed: ${reg.status}`);

  // Before step-up: not strong.
  assert.equal((await json(await h.req("/auth/me", { cookie: ADMIN }))).strongAuth, false);

  // Challenge.
  const ch = await h.req("/auth/passkey/step-up/challenge", { method: "POST", cookie: ADMIN });
  assert.equal(ch.status, 200);
  const { challenge, credentialIds } = await json(ch);
  assert.ok(credentialIds.includes("cred-1"));

  // Sign + verify.
  const assertion = { credentialId: "cred-1", challenge, ...authenticatorSign(challenge) };
  const up = await h.req("/auth/passkey/step-up", { method: "POST", cookie: ADMIN, body: assertion });
  assert.equal(up.status, 200);
  assert.equal((await json(up)).strongAuth, true);

  // The upgraded session cookie now reports strong auth.
  const upgraded = cookiesFrom(up);
  assert.match(upgraded, /omni_session=/);
  assert.equal((await json(await h.req("/auth/me", { cookie: upgraded }))).strongAuth, true);

  // The one-time challenge can't be replayed.
  const replay = await h.req("/auth/passkey/step-up", { method: "POST", cookie: ADMIN, body: assertion });
  assert.equal(replay.status, 400);
});

test("a forged assertion (wrong key) is rejected", async () => {
  const ch = await json(await h.req("/auth/passkey/step-up/challenge", { method: "POST", cookie: ADMIN }));
  const rogue = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  const clientDataBytes = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: ch.challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientDataBytes)]), rogue).toString("base64url");
  const r = await h.req("/auth/passkey/step-up", { method: "POST", cookie: ADMIN, body: { credentialId: "cred-1", challenge: ch.challenge, clientDataJSON: clientDataBytes.toString("base64url"), authenticatorData: authData.toString("base64url"), signature } });
  assert.equal(r.status, 401);
});

test("step-up requires a session", async () => {
  assert.equal((await h.req("/auth/passkey/step-up/challenge", { method: "POST" })).status, 401);
});
