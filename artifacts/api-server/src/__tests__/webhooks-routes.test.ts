import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * HTTP coverage for the outbound-webhook admin routes under the §0 invariant. Adding a webhook opens a NEW
 * egress channel, so a create is a security reduction: it is HELD for a signed sign-off (202), the signing
 * secret is surfaced once, and it goes live only after the solo admin confirm+signs. A DELETE strengthens
 * the posture (one fewer egress target) and applies immediately (200). Demo auth → admin; the webhooks
 * entitlement is enabled via a dev override (non-production).
 */
const SECRET = "test-session-secret-webhooks-routes";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "test"; // non-production so the dev entitlement override applies
process.env["RATE_LIMIT_DISABLED"] = "true";
delete process.env["OIDC_ISSUER_URL"]; // demo mode → every session is admin

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const SESSION = cookie({ sub: "wh-admin", email: "a@x.io", roles: [], stepUpAt: Date.now() });

let server: Server;
let base: string;
before(async () => {
  const { default: app } = await import("../app");
  const { setDevEntitlementOverride } = await import("../lib/dev-entitlements");
  setDevEntitlementOverride("webhooks", true);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  const { clearDevEntitlementOverrides } = await import("../lib/dev-entitlements");
  clearDevEntitlementOverrides();
  server?.close();
});
afterEach(async () => { (await import("../lib/settings")).updateSettings({ webhooks: [] }); });

const req = (path: string, init?: RequestInit) => fetch(`${base}/api${path}`, { ...init, headers: { cookie: SESSION, ...(init?.headers ?? {}) } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

const SO_KEYS = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
let passkeyReady = false;
async function signOff(proposalId: string, sub = "wh-admin"): Promise<void> {
  const { registerCredential } = await import("../lib/passkey");
  const { challengeForStage, submitDecision } = await import("../lib/approval-service");
  if (!passkeyReady) {
    await registerCredential(sub, { credentialId: "solo", publicKeySpki: SO_KEYS.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
    passkeyReady = true;
  }
  const ch = (await challengeForStage(proposalId, sub))!;
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: ch.challenge, origin: "https://localhost", crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from("localhost")), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), SO_KEYS.privateKey);
  const res = await submitDecision(proposalId, { sub, roles: ["admin"], via: "human" }, {
    decision: "approve", credentialId: "solo",
    clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url"),
  });
  assert.equal(res.executed, true);
}

test("POST /webhooks HOLDS the create for a signed sign-off (202), then it goes live after sign-off", async () => {
  const created = await req("/webhooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://hooks.example.com/omni", events: ["notification"] }) });
  assert.equal(created.status, 202);
  const body = await json(created);
  assert.equal(typeof body.pending.proposalId, "string");
  assert.ok(body.webhook.secret, "the signing secret is surfaced once, at propose time");
  assert.deepEqual(body.pending.relaxes, ["webhooks"]);

  // Not live yet — held.
  assert.deepEqual((await json(await req("/webhooks"))).webhooks, []);

  await signOff(body.pending.proposalId);
  const listed = (await json(await req("/webhooks"))).webhooks;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].url, "https://hooks.example.com/omni");
  assert.equal(listed[0].secretSet, true);
  assert.equal("secret" in listed[0], false); // GET never re-exposes the secret
});

test("DELETE /webhooks/:id strengthens the posture → applies immediately (200)", async () => {
  // Seed one directly, then delete it through the route.
  const { createWebhook } = await import("../lib/webhooks");
  const sub = createWebhook({ url: "https://hooks.example.com/x", events: ["notification"] });
  const del = await req(`/webhooks/${sub.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal((await json(del)).deleted, true);
  assert.deepEqual((await json(await req("/webhooks"))).webhooks, []);
});

test("DELETE /webhooks/:id on an unknown id → 404", async () => {
  const del = await req("/webhooks/nope", { method: "DELETE" });
  assert.equal(del.status, 404);
});
