import crypto from "node:crypto";
import { sharedKv } from "./shared-state";
import { safeParseJson } from "./safe-json";

/**
 * Passkey (WebAuthn) signing foundation for approvals — the crypto that makes an approval **unforgeable
 * even by the server**. A private key lives only in the approver's authenticator (Touch ID / security key /
 * platform passkey); we store ONLY its public key. Every approval is a fresh, one-time **challenge** the
 * device signs, so a signature is bound to exactly one approval and can't be replayed. The gateway never
 * holds a private key, so it cannot forge an approval — see docs/design/WORKFLOW-APPROVAL-CHAINS.md §4.
 *
 * Verification is done here with Node `crypto` (ES256 / P-256) — no external SDK — and is a pure function
 * of its inputs, so it is unit-testable against a simulated authenticator. The credential + challenge
 * stores live in the shared-state seam (in-process by default, Redis fleet-wide), like `dual-control`.
 */

const b64url = (b: Buffer): string => b.toString("base64url");
const sha256 = (b: Buffer): Buffer => crypto.createHash("sha256").update(b).digest();

export class AssertionError extends Error {
  constructor(message: string) { super(message); this.name = "AssertionError"; }
}

// ── Credential store (per user `sub`) ────────────────────────────────────────
export interface PasskeyCredential {
  /** The WebAuthn credential id (base64url), unique per authenticator. */
  credentialId: string;
  /** The credential's PUBLIC key as SPKI DER, base64 (from the browser's `getPublicKey()`). */
  publicKeySpki: string;
  alg: "ES256";
  createdAt: string;
}
const CRED_PREFIX = "pk:cred:";
const credKey = (sub: string): string => `${CRED_PREFIX}${sub}`;

/** A public key we can verify against — throws if the stored SPKI isn't a usable EC P-256 key. */
function keyObjectFromSpki(spkiB64: string): crypto.KeyObject {
  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey({ key: Buffer.from(spkiB64, "base64"), format: "der", type: "spki" });
  } catch {
    throw new AssertionError("credential public key is not valid SPKI");
  }
  if (key.asymmetricKeyType !== "ec") throw new AssertionError("credential is not an EC key");
  return key;
}

/** Register a passkey public key for a user. Validates the SPKI parses as an EC P-256 key before storing. */
export async function registerCredential(sub: string, input: { credentialId: string; publicKeySpki: string }): Promise<PasskeyCredential> {
  if (!sub || !input.credentialId || !input.publicKeySpki) throw new AssertionError("sub, credentialId and publicKeySpki are required");
  keyObjectFromSpki(input.publicKeySpki); // throws if invalid
  const cred: PasskeyCredential = { credentialId: input.credentialId, publicKeySpki: input.publicKeySpki, alg: "ES256", createdAt: new Date().toISOString() };
  const existing = await credentialsFor(sub);
  const next = [...existing.filter((c) => c.credentialId !== cred.credentialId), cred];
  await sharedKv.set(credKey(sub), JSON.stringify(next));
  return cred;
}

/** Every passkey registered for a user (empty if none / malformed). */
export async function credentialsFor(sub: string): Promise<PasskeyCredential[]> {
  const raw = await sharedKv.get(credKey(sub));
  if (!raw) return [];
  let arr: unknown;
  try { arr = safeParseJson<unknown>(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter((c): c is PasskeyCredential =>
    !!c && typeof c === "object" && typeof (c as PasskeyCredential).credentialId === "string" && typeof (c as PasskeyCredential).publicKeySpki === "string");
}

/** One registered credential for `sub` by its id, or null when the user has no such passkey. */
export async function getCredential(sub: string, credentialId: string): Promise<PasskeyCredential | null> {
  return (await credentialsFor(sub)).find((c) => c.credentialId === credentialId) ?? null;
}

/** Revoke ALL of a user's passkeys — the offboarding hook AND the admin/PMO "revoke a named individual"
 *  action: once revoked, their signatures no longer verify, so any responsibility acceptance keyed to them
 *  lapses (design §4.2). Past audit records are untouched. */
export async function revokeCredentials(sub: string): Promise<void> {
  await sharedKv.del(credKey(sub));
}

/** Revoke EVERYONE's passkeys — an admin/PMO emergency reset (e.g. suspected mass compromise). All approval
 *  signing halts until users re-enrol; any responsibility acceptance keyed to a revoked user lapses. Past
 *  audit records are untouched. Returns how many users were affected. */
export async function revokeAllCredentials(): Promise<number> {
  const entries = await sharedKv.list(CRED_PREFIX);
  for (const { key } of entries) await sharedKv.del(key);
  return entries.length;
}

// ── Per-approval challenge (one-time, TTL-bounded) ───────────────────────────
const CHAL_PREFIX = "pk:chal:";
const CHAL_TTL_MS = 5 * 60 * 1000; // an approval challenge is short-lived
const chalKey = (scope: string): string => `${CHAL_PREFIX}${scope}`;

/**
 * Issue a fresh, one-time challenge for a specific approval `scope` (e.g. `${proposalId}:${stageId}`),
 * binding the exact content being approved via `contentHash` so a signature can't be lifted onto another
 * action. Returns the base64url challenge the client passes to `navigator.credentials.get`.
 */
export async function issueChallenge(scope: string, contentHash: string): Promise<string> {
  const challenge = b64url(Buffer.concat([crypto.randomBytes(24), sha256(Buffer.from(`${scope}|${contentHash}`)).subarray(0, 8)]));
  await sharedKv.set(chalKey(scope), challenge, { ttlMs: CHAL_TTL_MS });
  return challenge;
}

/** Consume a challenge: it must match what was issued for `scope`, and is deleted so it can be used ONCE. */
export async function consumeChallenge(scope: string, presented: string): Promise<boolean> {
  const stored = await sharedKv.get(chalKey(scope));
  if (!stored || stored !== presented) return false;
  await sharedKv.del(chalKey(scope));
  return true;
}

// ── WebAuthn assertion verification (pure) ───────────────────────────────────
export interface AssertionInput {
  credential: Pick<PasskeyCredential, "publicKeySpki">;
  /** Raw bytes (base64url) exactly as returned by the authenticator. */
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  /** The challenge the SERVER issued for this approval (base64url) — must equal clientData.challenge. */
  expectedChallenge: string;
  /** The Relying Party id (domain) and the exact expected origin. */
  rpId: string;
  origin: string;
  /** Require user-verification (biometric/PIN), not just user-presence. Default true for approvals. */
  requireUserVerification?: boolean;
}

/**
 * Verify a WebAuthn assertion (`navigator.credentials.get`). Checks, in order: clientData is a `webauthn.get`
 * for the exact challenge + origin; authenticatorData's rpIdHash matches; user-present (and, by default,
 * user-verified) flags are set; and the ECDSA/SHA-256 signature over `authenticatorData ‖ SHA256(clientData)`
 * validates against the stored public key. Returns an opaque `sigRef` for the audit trail. Throws
 * {@link AssertionError} on any failure — never returns a partial pass.
 */
export function verifyWebAuthnAssertion(input: AssertionInput): { ok: true; sigRef: string } {
  const clientDataBytes = Buffer.from(input.clientDataJSON, "base64url");
  let clientData: Record<string, unknown>;
  try { clientData = safeParseJson<Record<string, unknown>>(clientDataBytes.toString("utf8")); }
  catch { throw new AssertionError("clientDataJSON is not valid JSON"); }

  if (clientData["type"] !== "webauthn.get") throw new AssertionError("clientData.type must be webauthn.get");
  if (clientData["challenge"] !== input.expectedChallenge) throw new AssertionError("challenge mismatch (replayed or wrong approval)");
  if (clientData["origin"] !== input.origin) throw new AssertionError("origin mismatch");

  const authData = Buffer.from(input.authenticatorData, "base64url");
  if (authData.length < 37) throw new AssertionError("authenticatorData too short");
  const rpIdHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(rpIdHash, sha256(Buffer.from(input.rpId)))) throw new AssertionError("rpIdHash mismatch");
  const flags = authData[32]!;
  if ((flags & 0x01) === 0) throw new AssertionError("user-present flag not set");
  if ((input.requireUserVerification ?? true) && (flags & 0x04) === 0) throw new AssertionError("user-verification required but flag not set");

  const signatureBase = Buffer.concat([authData, sha256(clientDataBytes)]);
  const signature = Buffer.from(input.signature, "base64url");
  const key = keyObjectFromSpki(input.credential.publicKeySpki);
  const ok = crypto.verify("sha256", signatureBase, key, signature); // EC ⇒ DER-encoded signature (WebAuthn default)
  if (!ok) throw new AssertionError("signature does not verify");
  return { ok: true, sigRef: b64url(sha256(signature)) };
}
