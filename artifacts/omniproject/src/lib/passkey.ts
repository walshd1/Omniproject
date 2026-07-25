/**
 * WebAuthn passkey ceremonies (browser side): enrol a passkey, and STEP UP an existing session to strong auth.
 * Step-up is what lets a local password admin unlock admin/PMO when the deployment requires a passkey
 * (LOCAL_ADMIN_REQUIRE_PASSKEY). Enrolment reuses the approvals passkey store (one credential per user serves
 * both approvals and step-up). The server verifies the assertion + re-issues the session as strong.
 *
 * No CBOR/COSE parsing: enrolment reads the SPKI public key straight from `response.getPublicKey()`.
 */

const enc = (buf: ArrayBuffer): string => {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
};
/** base64url (no padding) — matches how the server issues/compares the WebAuthn challenge. */
const encUrl = (buf: ArrayBuffer): string => enc(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decUrl = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** Whether this browser can do WebAuthn at all. */
export function passkeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

/**
 * Enrol a passkey for the signed-in user. Runs `navigator.credentials.create` (platform authenticator,
 * user-verifying), reads the SPKI public key, and registers it with the server. `sub`/`label` name the
 * credential in the authenticator UI. Throws on cancellation or an unsupported browser.
 */
export async function enrolPasskey(sub: string, label = "OmniProject"): Promise<void> {
  if (!passkeySupported()) throw new Error("This browser doesn't support passkeys.");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(sub);
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: window.location.hostname, name: label },
      user: { id: userId, name: sub, displayName: sub },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 (P-256), what the server verifies
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey enrolment was cancelled.");
  const response = cred.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey?.();
  if (!spki) throw new Error("This authenticator didn't return a usable public key.");
  const res = await fetch("/api/approvals/passkey", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId: encUrl(cred.rawId), publicKeySpki: enc(spki) }),
  });
  if (!res.ok) throw new Error("Could not register the passkey with the server.");
}

/**
 * Step up the current session to strong auth with an enrolled passkey. Fetches a one-time challenge, runs
 * `navigator.credentials.get`, and posts the assertion; on success the server re-issues the session as strong
 * (admin/PMO unlocked). Returns `{ needsEnrolment: true }` when the user has no passkey yet. Throws on a
 * failed/cancelled ceremony.
 */
export async function passkeyStepUp(): Promise<{ ok: boolean; needsEnrolment?: boolean }> {
  if (!passkeySupported()) throw new Error("This browser doesn't support passkeys.");
  const chRes = await fetch("/api/auth/passkey/step-up/challenge", { method: "POST", credentials: "same-origin" });
  if (chRes.status === 409) return { ok: false, needsEnrolment: true };
  if (!chRes.ok) throw new Error("Could not start passkey verification.");
  const { challenge, rpId, credentialIds } = (await chRes.json()) as { challenge: string; rpId: string; credentialIds: string[] };
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: decUrl(challenge),
      rpId,
      allowCredentials: credentialIds.map((id) => ({ id: decUrl(id), type: "public-key" as const })),
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Passkey verification was cancelled.");
  const r = assertion.response as AuthenticatorAssertionResponse;
  const res = await fetch("/api/auth/passkey/step-up", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credentialId: encUrl(assertion.rawId),
      challenge,
      clientDataJSON: encUrl(r.clientDataJSON),
      authenticatorData: encUrl(r.authenticatorData),
      signature: encUrl(r.signature),
    }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Passkey verification failed.");
  return { ok: true };
}
