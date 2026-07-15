import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env["WEBAUTHN_RP_ID"] = "omni.test";
process.env["WEBAUTHN_ORIGIN"] = "https://omni.test";

const { registerCredential } = await import("./passkey");
const { applySettingsGuarded } = await import("./settings-guard");
const { challengeForStage, submitDecision } = await import("./approval-service");
const { getSettings, updateSettings } = await import("./settings");
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
