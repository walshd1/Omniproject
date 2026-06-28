import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Admin key-revocation client (see the gateway's lib/key-registry + routes/security).
 * Revoking a key retires its current version and rolls to a fresh one — sessions under
 * the old version are rejected at once (you'll be signed out too), provenance under it
 * is flagged untrusted.
 */
export interface KeyStatus {
  name: string;
  version: number;
  revokedVersions: number[];
  rotatedAt: string | null;
  lastActor: string | null;
  lastReason: string | null;
}

/** Load the revocable keys + their status (admin). */
export function useSecurityKeys() {
  return useQuery<{ keys: KeyStatus[] }>({
    queryKey: ["security-keys"],
    queryFn: () => getJson("/api/security/keys"),
    staleTime: 30_000,
  });
}

/** Revoke + rotate a signing key (admin). */
export async function revokeKey(name: string, reason: string): Promise<void> {
  await fetch(`/api/security/keys/${encodeURIComponent(name)}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ reason }),
  });
}

/** Revoke all of one user's sessions (admin). */
export async function revokeUserSessions(sub: string): Promise<void> {
  await fetch("/api/security/sessions/revoke-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ sub }),
  });
}

/** The non-secret config-key fingerprint (admin) — confirm two deployments share a key. */
export function useConfigKeyFingerprint() {
  return useQuery<{ fingerprint: string }>({
    queryKey: ["config-key-fp"],
    queryFn: () => getJson("/api/security/config-key"),
    staleTime: 60_000,
  });
}

/** Securely export config (admin; step-up gated). Returns an ephemeral-keyed bundle +
 *  the one-time key; the internal at-rest key never leaves and is rotated server-side. */
export async function exportConfigBundle(): Promise<{ bundle: string; exportKey: string; warning: string }> {
  const res = await fetch("/api/security/config/export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(body.code === "step_up_required" ? "step_up_required" : body.error ?? `Failed (${res.status})`);
  }
  return (await res.json()) as { bundle: string; exportKey: string; warning: string };
}
