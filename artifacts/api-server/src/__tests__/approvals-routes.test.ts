import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * In-process HTTP coverage for the approval-chain router (routes/approvals.ts): passkey enrolment, the
 * inbox, and a full passkey-SIGNED decision driven through the real Express surface to executor firing.
 * The signing here simulates a browser authenticator; the harness admin session is `u-harness`.
 */
process.env["WEBAUTHN_RP_ID"] = "localhost";
process.env["WEBAUTHN_ORIGIN"] = "https://localhost";

const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const RP_ID = "localhost";
const ORIGIN = "https://localhost";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

function sign(challenge: string, decision: "approve" | "reject") {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
  return { decision, credentialId: "cred-http", clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url") };
}

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("unauthenticated approver surface is refused", async () => {
  const r = await h.req("/approvals/inbox", { method: "GET" });
  assert.equal(r.status, 401);
});

test("register passkey → propose → inbox → signed approve → executor runs", async () => {
  const cookie = adminCookie();
  // 1. enrol the caller's passkey public key
  const reg = await h.req("/approvals/passkey", { method: "POST", cookie, body: { credentialId: "cred-http", publicKeySpki: spki } });
  assert.equal(reg.status, 201);

  // 2. a proposal raised by SOMEONE ELSE (so the admin caller may approve it), on a single manager stage
  const { createProposal, registerApprovalExecutor } = await import("../lib/approval-service");
  let ran = false;
  registerApprovalExecutor("http-ship", () => { ran = true; });
  const id = await createProposal({
    def: { id: "d", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "manager" }] }] },
    action: "http-ship", params: { ok: 1 }, proposedBy: "someone-else",
  });

  // 3. inbox shows it to the eligible caller
  const inbox = await json(await h.req("/approvals/inbox", { method: "GET", cookie }));
  assert.ok(inbox.inbox.some((e: { id: string }) => e.id === id), "proposal in inbox");

  // 4. challenge → sign → decision
  const ch = await json(await h.req(`/approvals/${id}/challenge`, { method: "POST", cookie, body: {} }));
  assert.ok(ch.challenge);
  const dec = await h.req(`/approvals/${id}/decision`, { method: "POST", cookie, body: sign(ch.challenge, "approve") });
  assert.equal(dec.status, 200);
  const body = await json(dec);
  assert.equal(body.status, "approved");
  assert.equal(body.executed, true);
  assert.equal(ran, true);
});

test("a tampered signature is refused (403), executor does not run", async () => {
  const cookie = adminCookie();
  await h.req("/approvals/passkey", { method: "POST", cookie, body: { credentialId: "cred-http", publicKeySpki: spki } });
  const { createProposal, registerApprovalExecutor } = await import("../lib/approval-service");
  let ran = false;
  registerApprovalExecutor("http-nope", () => { ran = true; });
  const id = await createProposal({
    def: { id: "d", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "manager" }] }] },
    action: "http-nope", params: {}, proposedBy: "someone-else",
  });
  const ch = await json(await h.req(`/approvals/${id}/challenge`, { method: "POST", cookie, body: {} }));
  const signed = sign(ch.challenge, "approve");
  const bad = Buffer.from(signed.signature, "base64url"); bad[0] = (bad[0] ?? 0) ^ 0xff;
  const r = await h.req(`/approvals/${id}/decision`, { method: "POST", cookie, body: { ...signed, signature: bad.toString("base64url") } });
  assert.equal(r.status, 403);
  assert.equal(ran, false);
});
