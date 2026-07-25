import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startHarness, adminCookie, cookie, type Harness } from "./_harness";

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

test("admin/PMO can revoke a named user's passkeys and everyone's; unauth is refused", async () => {
  const cookie = adminCookie(); // harness admin holds pmo+ via hierarchy
  // enrol a victim's key, then revoke by name
  await h.req("/approvals/passkey", { method: "POST", cookie, body: { credentialId: "cred-http", publicKeySpki: spki } });
  const revoke = await h.req("/approvals/passkey/revoke", { method: "POST", cookie, body: { sub: "u-harness" } });
  assert.equal(revoke.status, 200);
  assert.deepEqual((await json(await h.req("/approvals/passkey", { method: "GET", cookie }))).credentials, []);
  // revoke-all
  const all = await h.req("/approvals/passkey/revoke-all", { method: "POST", cookie, body: {} });
  assert.equal(all.status, 200);
  assert.ok((await json(all)).revoked >= 0);
  // unauthenticated is refused
  assert.equal((await h.req("/approvals/passkey/revoke", { method: "POST", body: { sub: "x" } })).status, 401);
});

test("a command honours a portfolio read-only freeze by construction (mountCommand runs the ruleset)", async () => {
  // The action base checks the business ruleset for EVERY command — keyed on `ruleAction`, else the command
  // name (here `approval.passkey.revoke`, which sets no explicit ruleAction). A `read-only` hard freeze is a
  // write-wide rule, so it now blocks verb writes exactly as it blocks entity writes. This is a no-op under
  // default config (all rules off) — it only bites when an operator turns the freeze on.
  const cookie = adminCookie(); // harness admin holds pmo+ via hierarchy
  const { setRuleModes } = await import("../lib/ruleset");
  setRuleModes({ "read-only": "hard" });
  try {
    const frozen = await h.req("/approvals/passkey/revoke", { method: "POST", cookie, body: { sub: "u-harness" } });
    assert.equal(frozen.status, 422);
    assert.equal((await json(frozen)).rule, "read-only");
  } finally {
    setRuleModes({ "read-only": "off" }); // modes are process-global — restore for the other tests
  }
  // With the freeze lifted the same command proceeds.
  const ok = await h.req("/approvals/passkey/revoke", { method: "POST", cookie, body: { sub: "u-harness" } });
  assert.equal(ok.status, 200);
});

test("writing a SECURITY collection (approvalChains) is held for a signed sign-off (202), not applied", async () => {
  const cookie = adminCookie();
  const chain = { id: "c-http", scope: { kind: "org" }, rejectionPolicy: "abort", stages: [{ id: "s1", approvers: [{ kind: "role", role: "admin" }] }] };
  const r = await h.req("/approval-chains", { method: "PUT", cookie, body: { approvalChains: [chain] } });
  assert.equal(r.status, 202); // security-reducing (fail-closed) → held
  const body = await json(r);
  assert.ok(body.pending?.proposalId);
  assert.deepEqual(body.pending.relaxes, ["approvalChains"]);
});

test("an autonomous principal is refused from the human approver surface (no session→actor, no passkey, no acceptance)", async () => {
  // A namespaced non-human sub that somehow holds a session must never be treated as a human approver —
  // `via:"human"` is the only thing engaging the AI-approver gate + the engine's humanOnly restriction.
  const bot = cookie({ sub: "automation:bot-1", name: "bot", email: "bot@x.io", roles: ["omni-admins"] });
  // No actor is minted → the approver surface reads as unauthenticated (401), never as a human approver.
  assert.equal((await h.req("/approvals/inbox", { method: "GET", cookie: bot })).status, 401);
  // Cannot enrol a human passkey (403), and cannot sign a responsibility acceptance (403).
  assert.equal((await h.req("/approvals/passkey", { method: "POST", cookie: bot, body: { credentialId: "c", publicKeySpki: spki } })).status, 403);
  assert.equal((await h.req("/approvals/workflow-acceptances/wf-x", { method: "POST", cookie: bot, body: sign("x", "approve") })).status, 403);
  // An `agent:`-namespaced sub is treated the same way.
  const agent = cookie({ sub: "agent:run-9:approver", name: "a", email: "a@x.io", roles: ["omni-admins"] });
  assert.equal((await h.req("/approvals/passkey", { method: "POST", cookie: agent, body: { credentialId: "c", publicKeySpki: spki } })).status, 403);
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
