import fs from "node:fs";
import path from "node:path";
import { localPasswordRecovery } from "./auth-config";
import { logger } from "./logger";

/**
 * RECOVERY MODE — the data-isolation half of the local-password break-glass.
 *
 * `LOCAL_PASSWORD_RECOVERY` re-enables in-app passwords on a deployment that had stepped up to SSO (see
 * auth-config). On its own that would only re-key the credential store; this makes it also cut access to the
 * DATA so that re-enabling privileged local access on a (possibly compromised) box yields NO readable data —
 * "start afresh or restore from backup", exactly as intended.
 *
 * HOW: at boot, when recovery is engaged, EVERY sealed store is redirected to an isolated `recovery/`
 * subdirectory of OMNI_CONFIG_DIR. All stores resolve their paths under OMNI_CONFIG_DIR, so this one redirect
 * moves the whole system to a BLANK directory — the original org data stays on disk, untouched, but is never
 * loaded. An operator then either creates a new local admin from scratch or restores a backup INTO the recovery
 * dir (the portable plaintext export re-seals under the running key; a sealed backup needs its original key).
 *
 * SAFE + REVERSIBLE: the original directory is never written to in recovery mode, so disengaging recovery
 * returns to the original data intact. Nothing is destroyed on a false trigger — the guarantee is "not exposed
 * while recovery is engaged", not "irreversibly wiped". (True irreversibility = destroy the key material
 * out-of-band, a deliberate ops step this never does for you.)
 */

/** The isolated config directory recovery runs from — a `recovery/` child of the real OMNI_CONFIG_DIR. */
export function recoveryConfigDir(base: string): string {
  return path.join(base, "recovery");
}

/**
 * If the recovery break-glass is engaged AND an OMNI_CONFIG_DIR is set, redirect it to the isolated recovery
 * subdirectory (creating it) so every sealed store runs blank. Mutates `env` in place (so the lazily-read
 * OMNI_CONFIG_DIR every store consults is the recovery dir) and returns the effective directory. A no-op — and
 * returns the base dir — when recovery is off or no dir is configured. Idempotent: if already pointed at the
 * recovery dir, it won't nest a second `recovery/recovery`.
 */
export function engageRecoveryConfigDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env["OMNI_CONFIG_DIR"]?.trim();
  if (!base) return null;
  if (!localPasswordRecovery(env)) return base;
  if (path.basename(base) === "recovery") return base; // already engaged (idempotent)
  const dir = recoveryConfigDir(base);
  fs.mkdirSync(dir, { recursive: true });
  env["OMNI_CONFIG_DIR"] = dir;
  logger.warn(
    { recoveryDir: dir },
    "LOCAL_PASSWORD_RECOVERY engaged — running from an ISOLATED recovery config dir. The original org data is preserved on disk but NOT loaded; create a new local admin or restore from backup. Disengage recovery to return to the original data.",
  );
  return dir;
}
