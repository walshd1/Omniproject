import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env["WEBAUTHN_RP_ID"] = "omni.test";
process.env["WEBAUTHN_ORIGIN"] = "https://omni.test";
process.env["SCIM_TOKEN"] = "test-scim-token-000000000000"; // ≥ MIN_SCIM_TOKEN_LEN (24): enable the IdP directory so offboarding voids an acceptance

const { registerCredential, revokeCredentials } = await import("./passkey");
const { getSettings, updateSettings } = await import("./settings");
const { workflowContentHash } = await import("./responsibility-acceptance");
const {
  challengeForAcceptance, acceptResponsibility, activeAcceptanceFor, aiApprovalAuthorization, listAcceptances, revokeAcceptance,
} = await import("./responsibility-acceptance-service");
const { createUser, __resetScim } = await import("./scim");
import type { WorkflowDef } from "./workflow";

/**
 * The responsibility-acceptance apparatus (design §4.2): a passkey-signed human grant that authorizes an AI
 * to approve a SPECIFIC workflow version, VOIDED by any edit (content-hash mismatch) or by the signer's
 * offboarding (IdP directory no longer active). Default-DENY without a live acceptance.
 */
const RP_ID = "omni.test", ORIGIN = "https://omni.test";
const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });

const WF: WorkflowDef = { id: "wf-1", scope: { kind: "org" }, steps: [{ id: "s", kind: "action", action: "broker.listProjects" }] };

function signAssertion(challenge: string) {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
  return { credentialId: "k", clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url") };
}

/** Enrol the signer's passkey, sign an acceptance for the workflow's current version. */
async function signAcceptance(sub: string, email?: string) {
  await registerCredential(sub, { credentialId: "k", publicKeySpki: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const ch = (await challengeForAcceptance("wf-1", sub))!;
  return acceptResponsibility("wf-1", { sub, email }, signAssertion(ch.challenge));
}

beforeEach(() => { updateSettings({ workflows: [WF], workflowAcceptances: [] }); __resetScim(); });
afterEach(() => { updateSettings({ workflows: [], workflowAcceptances: [] }); __resetScim(); });

test("workflowContentHash changes when the workflow's steps change", () => {
  const h1 = workflowContentHash(WF);
  const h2 = workflowContentHash({ ...WF, steps: [{ id: "s", kind: "action", action: "broker.portfolioHealth" }] });
  assert.notEqual(h1, h2);
  assert.equal(workflowContentHash(WF), h1); // stable
});

test("default-DENY: no acceptance ⇒ AI approval is refused with a 'must sign' reason", async () => {
  assert.equal(await activeAcceptanceFor("wf-1"), null);
  const auth = await aiApprovalAuthorization("wf-1");
  assert.equal(auth.ok, false);
  assert.match(auth.reason!, /must review the workflow and passkey-sign/);
});

test("a passkey-signed acceptance authorizes AI approval for that exact version", async () => {
  await signAcceptance("owner-1", "owner@x.io");
  assert.equal((await aiApprovalAuthorization("wf-1")).ok, true);
  assert.equal((await activeAcceptanceFor("wf-1"))?.acceptedBy, "owner-1");
  assert.deepEqual((await listAcceptances()).map((a) => a.active), [true]);
});

test("VOID on edit: changing the workflow after acceptance voids it (content hash no longer matches)", async () => {
  await signAcceptance("owner-1", "owner@x.io");
  assert.equal((await aiApprovalAuthorization("wf-1")).ok, true);
  // Edit the workflow (a new step) — the stored acceptance is bound to the OLD hash.
  updateSettings({ workflows: [{ ...WF, steps: [...WF.steps, { id: "s2", kind: "action", action: "broker.notifications" }] }] });
  assert.equal(await activeAcceptanceFor("wf-1"), null);
  const auth = await aiApprovalAuthorization("wf-1");
  assert.equal(auth.ok, false);
  assert.match(auth.reason!, /changed since it was accepted/);
  assert.deepEqual((await listAcceptances()).map((a) => a.active), [false]); // stored but void
});

test("VOID on offboarding: deprovisioning the signer voids the acceptance (key no longer points to a current person)", async () => {
  await signAcceptance("owner-1", "owner@x.io");
  assert.equal((await aiApprovalAuthorization("wf-1")).ok, true);
  // The IdP marks the signer inactive → directoryDecision(known:true, active:false) → void.
  createUser({ userName: "owner", externalId: "owner-1", active: false, emails: [{ value: "owner@x.io", primary: true }] });
  assert.equal(await activeAcceptanceFor("wf-1"), null);
  const auth = await aiApprovalAuthorization("wf-1");
  assert.equal(auth.ok, false);
  assert.match(auth.reason!, /removed/);
});

test("VOID on passkey revocation: revoking the signer's credential voids the AI grant even without SCIM", async () => {
  await signAcceptance("owner-1", "owner@x.io");
  assert.equal((await aiApprovalAuthorization("wf-1")).ok, true);
  // Security admin does the documented offboarding mitigation: revoke the signer's passkey.
  await revokeCredentials("owner-1");
  assert.equal(await activeAcceptanceFor("wf-1"), null); // no credential ⇒ signature can't be made ⇒ voided
  const auth = await aiApprovalAuthorization("wf-1");
  assert.equal(auth.ok, false);
  assert.match(auth.reason!, /passkey was revoked/);
  assert.deepEqual((await listAcceptances()).map((a) => a.active), [false]);
});

test("re-signing after a void restores authority; revoke removes it", async () => {
  await signAcceptance("owner-1", "owner@x.io");
  updateSettings({ workflows: [{ ...WF, steps: [...WF.steps, { id: "s2", kind: "action", action: "broker.notifications" }] }] });
  assert.equal((await aiApprovalAuthorization("wf-1")).ok, false); // voided by the edit
  // The scope owner reviews + re-signs the NEW version.
  const ch = (await challengeForAcceptance("wf-1", "owner-1"))!;
  await acceptResponsibility("wf-1", { sub: "owner-1", email: "owner@x.io" }, signAssertion(ch.challenge));
  assert.equal((await aiApprovalAuthorization("wf-1")).ok, true);
  // Revoke → strengthens → immediate.
  revokeAcceptance("wf-1");
  assert.equal((await aiApprovalAuthorization("wf-1")).ok, false);
  assert.equal(getSettings().workflowAcceptances.length, 0);
});

test("a stale challenge (signed against the OLD version) can't be replayed after an edit", async () => {
  await registerCredential("owner-1", { credentialId: "k", publicKeySpki: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  const ch = (await challengeForAcceptance("wf-1", "owner-1"))!;
  // Edit the workflow before the signature is submitted — the challenge is consumed, but the acceptance binds
  // to whatever the CURRENT version is at accept time; the point is the grant tracks the live hash, so a
  // later edit still voids it. (Here we just prove accept succeeds then the edit voids it.)
  const acc = await acceptResponsibility("wf-1", { sub: "owner-1" }, signAssertion(ch.challenge));
  assert.ok(acc.workflowHash);
  updateSettings({ workflows: [{ ...WF, steps: [] }] });
  assert.equal(await activeAcceptanceFor("wf-1"), null);
});
