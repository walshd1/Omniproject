import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * Shared test helper: drive a HELD settings-relaxation proposal to "applied" by satisfying the solo admin
 * confirm+sign stage with a passkey-signed WebAuthn assertion. Used by the route suites that PATCH/PUT a
 * security-reducing setting — under the §0 invariant such a change is held for a signed sign-off, so these
 * tests must complete the ceremony to observe the applied state. RP defaults to localhost (none of these
 * harnesses set WEBAUTHN_RP_ID). One P-256 key is reused; each distinct `sub` registers its own credential
 * once per process (test files run in isolated processes with an in-process shared-state seam).
 */
const KEYS = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();
const registered = new Set<string>();

/** Register `sub`'s passkey once (idempotent per process), returning the credential id. */
async function ensureCredential(sub: string): Promise<void> {
  if (registered.has(sub)) return;
  const { registerCredential } = await import("../lib/passkey");
  await registerCredential(sub, { credentialId: "solo", publicKeySpki: KEYS.publicKey.export({ type: "spki", format: "der" }).toString("base64") });
  registered.add(sub);
}

/** Approve a held proposal as `sub` (the solo admin confirm+sign). Asserts the executor ran. */
export async function signOffRelaxation(proposalId: string, sub: string): Promise<void> {
  await ensureCredential(sub);
  const { challengeForStage, submitDecision } = await import("../lib/approval-service");
  const ch = (await challengeForStage(proposalId, sub))!;
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: ch.challenge, origin: "https://localhost", crossOrigin: false }));
  const authData = Buffer.concat([sha256(Buffer.from("localhost")), Buffer.from([0x05]), Buffer.alloc(4)]);
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientData)]), KEYS.privateKey);
  const res = await submitDecision(proposalId, { sub, roles: ["admin"], via: "human" }, {
    decision: "approve", credentialId: "solo",
    clientDataJSON: clientData.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: signature.toString("base64url"),
  });
  assert.equal(res.executed, true);
}
