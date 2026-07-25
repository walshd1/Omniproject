import { isDemoAuthFrom } from "./auth-config";
import { localUsersActive } from "./user-directory";

/**
 * RUNTIME auth-mode gate — the one auth predicate that depends on live STORE state (the local-user
 * directory), split out from the otherwise PURE `auth-config` module.
 *
 * `auth-config` holds env-only detectors (`isDemoAuthFrom`, `strongerAuthConfigured`, …) and is imported by
 * the offline tooling/typecheck (the setup wizard's `security-check`), which must stay free of the sealed
 * artifact-store subgraph `user-directory` pulls in. Keeping `isDemoAuth` here — not in `auth-config` — is
 * what preserves that: `auth-config` stays a leaf of pure env logic, and only code that genuinely runs at
 * request time reaches into the user directory.
 */

/**
 * Runtime gate: is the live process in demo auth mode? Starts from the pure env decision (shared with the boot
 * self-check `isDemoAuthFrom`) AND additionally turns demo OFF once ≥1 active local user exists — so creating
 * the first in-app admin in the setup wizard immediately stops "no IdP = everyone admin", without needing an
 * env change.
 */
export function isDemoAuth(): boolean {
  if (!isDemoAuthFrom(process.env)) return false;
  return !localUsersActive();
}
