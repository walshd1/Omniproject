import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env["WEBAUTHN_RP_ID"] = "omni.test";
process.env["WEBAUTHN_ORIGIN"] = "https://omni.test";

const { registerCredential } = await import("./passkey");
const {
  createProposal, challengeForStage, submitDecision, inboxFor, registerApprovalExecutor,
  ApprovalServiceError,
} = await import("./approval-service");
const { ApprovalChainError } = await import("./approval-chain");
import type { ChainDef, Actor } from "./approval-chain";
import type { SignedDecision } from "./approval-service";

const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const RP_ID = "omni.test";
const ORIGIN = "https://omni.test";

// One authenticator (keypair) per person; register its public key.
const people = new Map<string, crypto.KeyObject>();
async function enroll(sub: string): Promise<void> {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  people.set(sub, privateKey);
  await registerCredential(sub, { credentialId: `cred-${sub}`, publicKeySpki: publicKey.export({ type: "spki", format: "der" }).toString("base64") });
}
function sign(sub: string, challenge: string, decision: "approve" | "reject"): SignedDecision {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]); // UP+UV
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), people.get(sub)!);
  return { decision, credentialId: `cred-${sub}`, clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url") };
}
const actor = (sub: string, roles: string[]): Actor => ({ sub, roles, via: "human" });

const twoStage = (): ChainDef => ({
  id: "cd1", scope: { kind: "org" }, rejectionPolicy: "abort",
  stages: [{ id: "s1", approvers: [{ kind: "role", role: "pm" }] }, { id: "s2", approvers: [{ kind: "user", sub: "pmo-1" }] }],
});

test("full signed chain drives to approved and runs the executor exactly once", async () => {
  await enroll("alice"); await enroll("pmo-1");
  let ran: unknown = null;
  registerApprovalExecutor("ship-it", (params) => { ran = params; });
  const id = await createProposal({ def: twoStage(), action: "ship-it", params: { x: 1 }, proposedBy: "maker" });

  const c1 = (await challengeForStage(id, "alice"))!;
  assert.equal(c1.stageId, "s1");
  let r = await submitDecision(id, actor("alice", ["pm"]), sign("alice", c1.challenge, "approve"));
  assert.equal(r.status, "pending");
  assert.equal(ran, null); // not yet

  const c2 = (await challengeForStage(id, "pmo-1"))!;
  assert.equal(c2.stageId, "s2");
  r = await submitDecision(id, actor("pmo-1", ["pmo"]), sign("pmo-1", c2.challenge, "approve"));
  assert.equal(r.status, "approved");
  assert.equal(r.executed, true);
  assert.deepEqual(ran, { x: 1 });
});

test("a reject aborts the chain and the executor never runs", async () => {
  await enroll("alice");
  let ran = false;
  registerApprovalExecutor("noop", () => { ran = true; });
  const id = await createProposal({ def: twoStage(), action: "noop", params: {}, proposedBy: "maker" });
  const c = (await challengeForStage(id, "alice"))!;
  const r = await submitDecision(id, actor("alice", ["pm"]), sign("alice", c.challenge, "reject"));
  assert.equal(r.status, "rejected");
  assert.equal(ran, false);
});

test("the proposer cannot approve even with a valid signature (separation of duties)", async () => {
  await enroll("maker");
  const id = await createProposal({ def: twoStage(), action: "x", params: {}, proposedBy: "maker" });
  const c = (await challengeForStage(id, "maker"))!;
  // maker signs a perfectly valid assertion, but is the proposer → engine refuses AFTER crypto passes.
  await assert.rejects(() => submitDecision(id, actor("maker", ["pm"]), sign("maker", c.challenge, "approve")), ApprovalChainError);
});

test("a stale/replayed challenge is refused (one-time)", async () => {
  await enroll("alice");
  const id = await createProposal({ def: twoStage(), action: "x2", params: {}, proposedBy: "maker" });
  const c = (await challengeForStage(id, "alice"))!;
  await submitDecision(id, actor("alice", ["pm"]), sign("alice", c.challenge, "approve")); // consumes it, advances to s2
  // Re-using the s1 challenge fails: it's consumed, and s2 expects its own fresh challenge.
  await assert.rejects(() => submitDecision(id, actor("alice", ["pm"]), sign("alice", c.challenge, "approve")), ApprovalServiceError);
});

test("inbox shows a proposal to an eligible approver, hides it from the proposer and after they've decided", async () => {
  await enroll("alice"); await enroll("pmo-1");
  const id = await createProposal({ def: twoStage(), action: "inbox-test", params: {}, proposedBy: "maker" });
  const has = async (a: Actor) => (await inboxFor(a)).some((e) => e.id === id);
  assert.equal(await has(actor("alice", ["pm"])), true);   // eligible for s1
  assert.equal(await has(actor("maker", ["pm"])), false);  // proposer, never
  assert.equal(await has(actor("pmo-1", ["pmo"])), false); // s2, not active yet
  const c = (await challengeForStage(id, "alice"))!;
  await submitDecision(id, actor("alice", ["pm"]), sign("alice", c.challenge, "approve"));
  assert.equal(await has(actor("alice", ["pm"])), false);  // already decided s1
  assert.equal(await has(actor("pmo-1", ["pmo"])), true);  // now active at s2
});
