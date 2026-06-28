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
