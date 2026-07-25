import { useQuery } from "@tanstack/react-query";
import { sendJson } from "./api";

/**
 * Instance Recovery Key (IRK) + portable backup. The IRK is the portable secret an operator SAVES on first
 * setup (offline / printed) — the ONLY thing that opens an encrypted portable backup on a fresh box. Revealed
 * once; a portable backup is sealed under it; restore pastes the old key, then the instance rotates + reveals a
 * new one. All mutations are admin + step-up gated server-side.
 */
export interface RecoveryKeyStatus { available: boolean; revealed: boolean; fingerprint: string | null }

export const recoveryKeyStatusKey = ["recovery-key", "status"] as const;

export function useRecoveryKeyStatus() {
  return useQuery({
    queryKey: recoveryKeyStatusKey,
    queryFn: async (): Promise<RecoveryKeyStatus> => {
      const res = await fetch("/api/setup/instance-key", { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as RecoveryKeyStatus;
    },
    retry: false,
    staleTime: 30_000,
  });
}

/** Reveal the key ONCE (returns base64). Throws (409) if already revealed — rotate to mint a new one. */
export async function revealRecoveryKey(): Promise<{ key: string; fingerprint: string }> {
  return sendJson("/api/setup/instance-key/reveal", {}, "POST", "Could not reveal the key.");
}

/** Mint + reveal a fresh key (invalidates the old for future backups). */
export async function rotateRecoveryKey(): Promise<{ key: string; fingerprint: string }> {
  return sendJson("/api/setup/instance-key/rotate", {}, "POST", "Could not rotate the key.");
}

/** Download the portable backup (sealed under the IRK) as a file. */
export async function downloadPortableBackup(): Promise<void> {
  const res = await fetch("/api/setup/portable-backup", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not build the backup.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "omniproject-portable-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Restore a portable backup with the OLD key; returns the NEW key the instance rotated to (to save). */
export async function restorePortableBackup(bundle: unknown, key: string): Promise<{ restored: boolean; newKey: string; warnings: string[] }> {
  return sendJson("/api/setup/portable-restore", { bundle, key }, "POST", "Restore failed.");
}
