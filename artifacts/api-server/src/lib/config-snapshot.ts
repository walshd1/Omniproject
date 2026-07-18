import type { SettingsState } from "./settings";
import { CLASSIFIED_KEYS } from "./security-settings";

/**
 * Config snapshot / backup-restore.
 *
 * OmniProject is stateless, so the only thing worth snapshotting is the gateway
 * *configuration* it holds at runtime (the settings store). A snapshot is a
 * small, portable JSON you can take before a risky change and restore if a port
 * or setup goes wrong. It's also half of the FULL backup (paired with the
 * def-store export) that migrates a whole instance.
 *
 * COMPLETENESS (directive: "all org/programme/project/user settings live in the
 * JSON — keep your JSON safe, that's your total config"). The snapshot captures
 * the WHOLE settings state by DEFAULT — derived as every classified settings key
 * (minus, for the PLAINTEXT variant, the secret deny-list) — so a new knob
 * travels in the backup automatically and can never be silently dropped (the
 * drift guard in config-snapshot.test asserts captured ∪ excluded == every
 * settings key). This inverts the old hand-maintained allow-list, which captured
 * only a curated ~17 keys and silently lost the rest (priority weights,
 * scheduling, skills, field routing, currency, automations, templates,
 * governance/approval config, the RACI/stakeholder/allocation/budget registers …).
 *
 * SECRETS + THE TWO VARIANTS. The captured set depends on where the snapshot is
 * headed:
 *   - PLAINTEXT (`includeSecrets: false`, the default): the downloadable JSON is
 *     clear text the operator secures, so anything carrying a SECRET or a
 *     per-deployment CREDENTIAL is withheld (`EXCLUDED_KEYS`) — webhook signing
 *     secrets, peer bearer tokens, the external log destination, self-host DB
 *     creds, capability egress endpoints, and the passkey-signed AI grants.
 *   - SEALED (`includeSecrets: true`): used only inside the ENCRYPTED full backup
 *     (sealed with the deployment's own key via config-crypto). Because the file
 *     is ciphertext only the org's key opens, EVERYTHING travels — secrets
 *     included — so "keep the encrypted backup + your keys = the whole system
 *     state" is literally true. `applySnapshot` only writes secret keys back when
 *     the caller explicitly opts in (`allowSecrets`), which the sealed-restore
 *     path does after the AES-GCM tag has authenticated the bundle.
 *
 * Durable env secrets (SESSION_SECRET, OIDC_CLIENT_SECRET, NOTIFY_INGEST_SECRET,
 * REDIS_URL) never live in settings at all — they stay in the environment.
 *
 * Pure + side-effect free so it's unit-tested.
 */

export const SNAPSHOT_SCHEMA = "omniproject/config-snapshot";
export const SNAPSHOT_VERSION = 1;

/** Settings keys withheld from a PLAINTEXT backup: each carries a secret, a per-deployment credential, or a
 *  signed grant that can't (and shouldn't) be replayed in clear. They DO travel inside the encrypted (sealed)
 *  full backup. Everything NOT listed here is captured in both variants — so a newly-added config key travels
 *  by default; only a deliberately secret-bearing one is held back from plaintext. */
export const EXCLUDED_KEYS: ReadonlySet<string> = new Set([
  // NB `loggingSync` + `selfHost` left SettingsState for their own config defs (Phase C) — they now ride the
  // sealed org config-def backup (not this settings snapshot), so they're no longer listed here.
  "webhooks", "federatedPeers", "capabilityStates", "workflowAcceptances",
]);

/** Every classified settings key, sorted — the COMPLETE set captured in a sealed backup. Derived (not
 *  hand-listed) so it can't drift from the real `SettingsState`. */
export const ALL_SETTINGS_KEYS: readonly string[] = [...CLASSIFIED_KEYS].sort();

/** The PLAINTEXT-safe captured set: every classified key except the secret-bearing deny-list. */
export const SNAPSHOT_KEYS: readonly string[] = ALL_SETTINGS_KEYS.filter((k) => !EXCLUDED_KEYS.has(k));

/** Which keys a snapshot captures, given whether secrets are allowed to ride along. */
function capturedKeys(includeSecrets: boolean): readonly string[] {
  return includeSecrets ? ALL_SETTINGS_KEYS : SNAPSHOT_KEYS;
}

export interface ConfigSnapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  version: number;
  createdAt: string;
  /** A partial `SettingsState`: every captured key. Secret-bearing keys appear only in a sealed backup. */
  settings: Partial<SettingsState>;
}

/** Capture the current settings as a portable, versioned config snapshot. Iterates the DERIVED captured set
 *  (every classified key, minus the secret deny-list unless `includeSecrets`) so the captured set can't
 *  silently drift from what `applySnapshot` restores, and a new settings key is captured without a code change.
 *  `includeSecrets` is set only by the encrypted full-backup path. */
export function buildSnapshot(settings: SettingsState, includeSecrets = false): ConfigSnapshot {
  const src = settings as unknown as Record<string, unknown>;
  const keys = capturedKeys(includeSecrets);
  const snapshotSettings = Object.fromEntries(keys.map((key) => [key, src[key]])) as Partial<SettingsState>;
  return {
    schema: SNAPSHOT_SCHEMA,
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    settings: snapshotSettings,
  };
}

/**
 * Validate a snapshot and produce a settings patch to apply. Throws on a
 * structurally invalid snapshot; collects non-fatal issues as warnings.
 *
 * By default only the plaintext-safe keys are applied — a secret-bearing key
 * present in an untrusted (plaintext) snapshot is ignored, never written. The
 * SEALED restore path passes `allowSecrets: true` (the AES-GCM tag has already
 * proven the bundle came from this deployment's own key), so a full encrypted
 * backup restores secrets too.
 */
export function applySnapshot(input: unknown, opts: { allowSecrets?: boolean } = {}): { patch: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  if (!input || typeof input !== "object") throw new Error("Snapshot must be a JSON object");

  const snap = input as Partial<ConfigSnapshot> & { settings?: Record<string, unknown> };
  if (snap.schema !== SNAPSHOT_SCHEMA) throw new Error(`Unrecognised snapshot schema: ${String(snap.schema)}`);
  if (snap.version !== SNAPSHOT_VERSION) warnings.push(`Snapshot version ${String(snap.version)} differs from ${SNAPSHOT_VERSION}; applying best-effort`);

  const s = snap.settings;
  if (!s || typeof s !== "object") throw new Error("Snapshot is missing a settings object");

  const keys = capturedKeys(opts.allowSecrets === true);
  const captured = new Set(keys);
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in s) patch[key] = (s as Record<string, unknown>)[key];
    else warnings.push(`Snapshot omits "${key}" — left unchanged`);
  }
  for (const key of Object.keys(s)) {
    if (captured.has(key)) continue;
    // A key the snapshot carries that we don't restore: a deliberately-excluded secret-bearing key on a
    // plaintext restore (never write it back), or a genuinely unknown one. Both are surfaced, neither applied.
    warnings.push(EXCLUDED_KEYS.has(key) ? `Ignored secret-bearing setting "${key}" (excluded from restore)` : `Ignored unknown setting "${key}"`);
  }
  return { patch, warnings };
}
