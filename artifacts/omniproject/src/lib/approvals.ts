/**
 * Approval-decision ceremony (browser side). An approver signs the CURRENT stage of a proposal with their
 * passkey to APPROVE or REJECT it — the same WebAuthn assertion `passkey.ts` uses for step-up, but bound to a
 * proposal + stage instead of the session. This is the first in-browser proposal-decision surface; it drives
 * the existing gateway endpoints (`/approvals/:id/challenge` → `/approvals/:id/decision`). Both approve and
 * reject are signed, so an abort is as auditable as a sign-off.
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

/** Whether this browser can run the passkey ceremony at all. */
export function passkeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

/**
 * Sign a decision on a proposal's current stage. Fetches a one-time challenge, runs `navigator.credentials.get`,
 * and posts the assertion with the chosen `decision`. Resolves when the gateway records the signed decision;
 * throws with the gateway's message (or a cancellation message) otherwise. `decision:"reject"` is a signed
 * ABORT — it needs a passkey just like an approval.
 */
export async function decideProposal(proposalId: string, decision: "approve" | "reject"): Promise<void> {
  if (!passkeySupported()) throw new Error("This browser doesn't support passkeys.");
  const chRes = await fetch(`/api/approvals/${encodeURIComponent(proposalId)}/challenge`, { method: "POST", credentials: "same-origin" });
  if (chRes.status === 404) throw new Error("This item is no longer awaiting your decision.");
  if (!chRes.ok) throw new Error("Could not start passkey verification.");
  const { challenge, rpId } = (await chRes.json()) as { challenge: string; rpId: string; stageId: string };

  const assertion = (await navigator.credentials.get({
    publicKey: { challenge: decUrl(challenge), rpId, userVerification: "required", timeout: 60_000 },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Passkey verification was cancelled.");
  const r = assertion.response as AuthenticatorAssertionResponse;

  const res = await fetch(`/api/approvals/${encodeURIComponent(proposalId)}/decision`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decision,
      credentialId: encUrl(assertion.rawId),
      clientDataJSON: encUrl(r.clientDataJSON),
      authenticatorData: encUrl(r.authenticatorData),
      signature: encUrl(r.signature),
    }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The decision could not be recorded.");
}
