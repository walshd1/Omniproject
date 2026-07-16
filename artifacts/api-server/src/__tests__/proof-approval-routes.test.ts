import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Proof decision → APPROVAL CHAIN binding (roadmap 2.4 slice 4), end-to-end over the real app. When an admin
 * binds `proof.decision` to a chain, a reviewer's approve is HELD (202) and only stamped onto the proof after
 * a DIFFERENT approver signs it off with a passkey — auditable + non-repudiable. The signing here simulates a
 * browser authenticator (P-256), mirroring approvals-routes.test.ts.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "proofing";
process.env["SECURITY_STRICT"] = "off";
process.env["WEBAUTHN_RP_ID"] = "localhost";
process.env["WEBAUTHN_ORIGIN"] = "https://localhost";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "proof-approval-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const RP_ID = "localhost", ORIGIN = "https://localhost";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
function sign(challenge: string, decision: "approve" | "reject") {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
  return { decision, credentialId: "cred-proof", clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url") };
}

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
// Two admins: the REVIEWER raises the decision; a DIFFERENT APPROVER signs it off (separation of duties).
const REVIEWER = cookie({ sub: "rev", name: "Ree", email: "rev@x.io", roles: ["omni-admins"] });
const APPROVER = cookie({ sub: "app", name: "App", email: "app@x.io", roles: ["omni-admins"] });

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? REVIEWER, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Bind `proof.decision` to a single-stage org chain approved by anyone holding the admin role.
  const { updateSettings } = await import("../lib/settings");
  updateSettings({
    approvalChains: [{ id: "proof-chain", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "admin" }] }] }],
    approvalBindings: [{ action: "proof.decision", chainId: "proof-chain" }],
  });
});
after(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ approvalChains: [], approvalBindings: [] });
  server?.close();
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
});

const DELIVERABLE = { kind: "image", url: "https://cdn.example/mock.png" };

test("a bound proof decision is held for a passkey-signed sign-off, then applied on approval", async () => {
  // 1. The reviewer creates a proof and requests approval.
  const proof = (await json(await req("/proofs", { method: "POST", body: { name: "Banner", deliverable: DELIVERABLE, annotations: [] } }))) as { id: string };
  const held = await req(`/proofs/${proof.id}/decision`, { method: "POST", body: { decision: "approved" } });
  assert.equal(held.status, 202, "the decision is held, not applied");
  const pending = (await json(held)).pending as { proposalId: string; action: string };
  assert.ok(pending.proposalId);
  assert.equal(pending.action, "proof.decision");

  // 2. It is NOT applied yet — the proof is still pending.
  assert.equal(((await json(await req(`/proofs/${proof.id}`))) as { decision: string }).decision, "pending");

  // 3. A DIFFERENT approver enrols a passkey, sees the proposal, and signs off.
  assert.equal((await req("/approvals/passkey", { method: "POST", cookie: APPROVER, body: { credentialId: "cred-proof", publicKeySpki: spki } })).status, 201);
  const inbox = await json(await req("/approvals/inbox", { cookie: APPROVER }));
  assert.ok(inbox.inbox.some((e: { id: string }) => e.id === pending.proposalId), "the proposal is in the approver's inbox");
  const ch = await json(await req(`/approvals/${pending.proposalId}/challenge`, { method: "POST", cookie: APPROVER, body: {} }));
  const dec = await req(`/approvals/${pending.proposalId}/decision`, { method: "POST", cookie: APPROVER, body: sign(ch.challenge, "approve") });
  assert.equal(dec.status, 200);
  const decBody = await json(dec);
  assert.equal(decBody.status, "approved");
  assert.equal(decBody.executed, true, "the executor ran on final approval");

  // 4. The decision is now stamped on the proof, bound to the version, attributed to the reviewer.
  const finalProof = (await json(await req(`/proofs/${proof.id}`))) as { decision: string; decisionVersion: number; decidedBy: string };
  assert.equal(finalProof.decision, "approved");
  assert.equal(finalProof.decisionVersion, 1);
  assert.equal(finalProof.decidedBy, "rev@x.io");
});

test("the proposer cannot self-approve their own proof decision (separation of duties)", async () => {
  const proof = (await json(await req("/proofs", { method: "POST", body: { name: "Poster", deliverable: DELIVERABLE, annotations: [] } }))) as { id: string };
  const pending = (await json(await req(`/proofs/${proof.id}/decision`, { method: "POST", body: { decision: "approved" } }))).pending as { proposalId: string };
  // The reviewer enrols + tries to sign their OWN proposal → refused (403), effect never runs.
  await req("/approvals/passkey", { method: "POST", cookie: REVIEWER, body: { credentialId: "cred-proof", publicKeySpki: spki } });
  const ch = await req(`/approvals/${pending.proposalId}/challenge`, { method: "POST", cookie: REVIEWER, body: {} });
  // The proposer isn't eligible for the stage, so there's no challenge to sign (or the decision is refused).
  if (ch.status === 200) {
    const sig = sign((await json(ch)).challenge, "approve");
    assert.equal((await req(`/approvals/${pending.proposalId}/decision`, { method: "POST", cookie: REVIEWER, body: sig })).status, 403);
  } else {
    assert.ok(ch.status === 404 || ch.status === 403, "proposer gets no signable challenge");
  }
  assert.equal(((await json(await req(`/proofs/${proof.id}`))) as { decision: string }).decision, "pending", "still unapproved");
});
