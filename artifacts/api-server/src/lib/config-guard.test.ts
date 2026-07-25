import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Store (writeOrgConfigCollection) + sealing (config-crypto) need these before the modules load.
process.env["SESSION_SECRET"] ??= "config-guard-test-secret";
process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "config-guard-"));
process.env["WEBAUTHN_RP_ID"] = "omni.test";
process.env["WEBAUTHN_ORIGIN"] = "https://omni.test";

const { SECURITY_CONFIGS } = await import("./security-config");
const { applyConfigCollectionGuarded } = await import("./config-guard");
const { readConfigCollection, writeOrgConfigCollection } = await import("./scoped-config");
const { challengeForStage, submitDecision } = await import("./approval-service");
const { registerCredential } = await import("./passkey");
import type { Actor } from "./approval-chain";

// A synthetic security-classified config for the mechanism test: an egress TOGGLE whose relaxation is "turning
// it ON" (enabling external egress). Registering it here is exactly how a Phase C migration slice will register
// a real config's predicate. Directional: enabling relaxes; disabling strengthens (applies immediately).
const CONFIG_ID = "__test-egress-toggle";
SECURITY_CONFIGS[CONFIG_ID] = (o, n) => n === true && o !== true;

const RP_ID = "omni.test", ORIGIN = "https://omni.test";
const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const admin = (sub: string): Actor => ({ sub, roles: ["admin"], via: "human" });
let credRegistered = false;

/** Drive a held config-relaxation proposal to "applied" by satisfying the solo admin confirm+sign stage. */
async function signOff(proposalId: string, sub: string): Promise<void> {
  if (!credRegistered) {
    await registerCredential(sub, { credentialId: "solo", publicKeySpki: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
    credRegistered = true;
  }
  const ch = (await challengeForStage(proposalId, sub))!;
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: ch.challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
  const res = await submitDecision(proposalId, admin(sub), {
    decision: "approve", credentialId: "solo",
    clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url"),
  });
  assert.equal(res.executed, true);
}

test("a strengthening write to a security config applies immediately (no sign-off)", async () => {
  // Seed it ON so that writing OFF is a strengthening move.
  writeOrgConfigCollection(CONFIG_ID, "Test egress", true);
  const r = await applyConfigCollectionGuarded(CONFIG_ID, "Test egress", false, "someone");
  assert.equal(r.applied, true);
  assert.equal(readConfigCollection<boolean | null>(CONFIG_ID, null), false);
});

test("a relaxing write is HELD for a signed sign-off, then applies on approval", async () => {
  // Start OFF (strengthened), then attempt to turn egress ON — a relaxation.
  writeOrgConfigCollection(CONFIG_ID, "Test egress", false);
  const r = await applyConfigCollectionGuarded(CONFIG_ID, "Test egress", true, "proposer");
  assert.equal(r.applied, false);
  assert.ok(r.pending?.proposalId, "a proposal was raised");
  assert.deepEqual(r.pending?.relaxes, [CONFIG_ID]);
  // NOT applied yet — the store still holds the old (strengthened) value while the sign-off is pending.
  assert.equal(readConfigCollection<boolean | null>(CONFIG_ID, null), false);

  await signOff(r.pending!.proposalId, "proposer");
  // The executor opened the sealed write and applied it.
  assert.equal(readConfigCollection<boolean | null>(CONFIG_ID, null), true);
});

test("a write to a NON-security config applies immediately through the guard", async () => {
  const CHOICE_ID = "__test-choice-collection";
  const r = await applyConfigCollectionGuarded(CHOICE_ID, "Choice", ["a", "b"], "someone");
  assert.equal(r.applied, true);
  assert.deepEqual(readConfigCollection<string[]>(CHOICE_ID, []), ["a", "b"]);
});
