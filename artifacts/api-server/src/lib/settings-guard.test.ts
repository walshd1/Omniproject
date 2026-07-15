import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env["WEBAUTHN_RP_ID"] = "omni.test";
process.env["WEBAUTHN_ORIGIN"] = "https://omni.test";

const { registerCredential } = await import("./passkey");
const { applySettingsGuarded } = await import("./settings-guard");
const { challengeForStage, submitDecision } = await import("./approval-service");
const { getSettings, updateSettings } = await import("./settings");
const { sharedKv } = await import("./shared-state");
import type { Actor } from "./approval-chain";

const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const RP_ID = "omni.test", ORIGIN = "https://omni.test";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
function sign(challenge: string) {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
  return { decision: "approve" as const, credentialId: "solo", clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url") };
}
const admin = (sub: string): Actor => ({ sub, roles: ["admin"], via: "human" });

test("a choice-only patch applies immediately (no sign-off)", async () => {
  const prev = getSettings().reportingCurrency;
  try {
    const r = await applySettingsGuarded({ reportingCurrency: "USD" }, "someone");
    assert.equal(r.applied, true);
    assert.equal(getSettings().reportingCurrency, "USD");
  } finally { updateSettings({ reportingCurrency: prev }); }
});

test("a security-RELAXING patch is HELD pending a signed sign-off; a solo admin confirm+sign then applies it", async () => {
  await registerCredential("solo-admin", { credentialId: "solo", publicKeySpki: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const prev = getSettings().backendSource;
  try {
    // backendSource is fail-closed security → any change relaxes → held, NOT applied yet.
    const r = await applySettingsGuarded({ backendSource: "switched" }, "solo-admin");
    assert.equal(r.applied, false);
    assert.ok(r.pending?.proposalId);
    assert.deepEqual(r.pending?.relaxes, ["backendSource"]);
    assert.equal(getSettings().backendSource, prev, "not applied until signed");

    // The single admin confirms + signs their OWN reduction (allowSelfApproval degrade).
    const ch = (await challengeForStage(r.pending!.proposalId, "solo-admin"))!;
    const res = await submitDecision(r.pending!.proposalId, admin("solo-admin"), sign(ch.challenge));
    assert.equal(res.status, "approved");
    assert.equal(res.executed, true);
    assert.equal(getSettings().backendSource, "switched", "applied only after the signed sign-off");
  } finally { updateSettings({ backendSource: prev }); }
});

test("a SECRET-carrying relaxation is SEALED in the queue — plaintext never sits at rest, but applies intact after sign-off", async () => {
  await registerCredential("secret-admin", { credentialId: "solo", publicKeySpki: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const SECRET = "SUPER-SECRET-HMAC-KEY-do-not-leak-9f3a";
  const webhook = { id: "wh1", url: "https://hooks.example.com/omni", secret: SECRET, events: ["project.updated"], active: true };
  const prev = getSettings().webhooks;
  try {
    // webhooks is fail-closed security (egress) → held. The patch carries a live secret.
    const r = await applySettingsGuarded({ webhooks: [webhook] }, "secret-admin");
    assert.equal(r.applied, false);
    assert.deepEqual(r.pending?.relaxes, ["webhooks"]);
    assert.equal(getSettings().webhooks.length, prev.length, "not applied until signed");

    // The secret must NOT be present anywhere in the queued proposal — it is sealed at rest.
    const raw = await sharedKv.get(`ac:prop:${r.pending!.proposalId}`);
    assert.ok(raw, "proposal is queued");
    assert.ok(!raw!.includes(SECRET), "the plaintext secret must not sit in the shared-state queue");
    assert.match(raw!, /__sealedPatch/, "the patch travels as a sealed token");

    // Sign it → the executor OPENS the seal and applies the real webhook, secret intact.
    const ch = (await challengeForStage(r.pending!.proposalId, "secret-admin"))!;
    const res = await submitDecision(r.pending!.proposalId, admin("secret-admin"), sign(ch.challenge));
    assert.equal(res.executed, true);
    const applied = getSettings().webhooks.find((w) => w.id === "wh1");
    assert.equal(applied?.secret, SECRET, "the real secret is applied only at executor time");
  } finally { updateSettings({ webhooks: prev }); }
});
