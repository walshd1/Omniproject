import { exportConfigBundle, type ExportedBundle } from "./config-crypto";
import { getSettings, updateSettings } from "./settings";
import { buildSnapshot, applySnapshot, type ConfigSnapshot } from "./config-snapshot";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";

/**
 * Configuration environments + versioned rollback.
 *
 * OmniProject stays stateless about *project data* — this versions only the
 * gateway's own *configuration* (the same settings the snapshot/restore covers).
 * It gives operators:
 *   - named environments (e.g. "production", "sandbox") so integration config can
 *     be designed/tested without touching production, then promoted;
 *   - an append-only version history with "known-good" tags, so a failed change
 *     can be rolled back instantly to a pinned good state.
 *
 * In-memory by default. Set CONFIG_STORE_FILE to a path to persist environments +
 * history across restarts (so rollback survives a crash). History is capped.
 */

export interface ConfigVersion {
  id: string;
  env: string;
  at: string;
  snapshot: ConfigSnapshot;
  label?: string;
  knownGood: boolean;
}

interface StoreState {
  activeEnv: string;
  environments: Record<string, ConfigSnapshot>;
  versions: ConfigVersion[];
}

const MAX_VERSIONS = 100;
const DEFAULT_ENV = "production";
// Encrypted at rest (AES-256-GCM) so a copy of the raw file is opaque off-box.
const store = new SealedFile(() => resolveConfigFile("CONFIG_STORE_FILE"), "config store");

let state: StoreState | null = null;
let counter = 0;

function nextId(): string {
  counter += 1;
  return `v${counter}`;
}

function persist(): void {
  if (!state) return;
  store.write(JSON.stringify({ ...state, counter }, null, 2));
}

function load(): StoreState | null {
  const raw = store.read();
  if (raw === null) return null;
  try {
    // Tolerate a legacy plaintext file so existing stores migrate.
    const parsed = JSON.parse(raw) as StoreState & { counter?: number };
    if (typeof parsed.counter === "number") counter = parsed.counter;
    return { activeEnv: parsed.activeEnv, environments: parsed.environments, versions: parsed.versions ?? [] };
  } catch (err) {
    logger.warn({ err }, "config store: failed to load — starting fresh");
    return null;
  }
}

function ensure(): StoreState {
  if (state) return state;
  state = load() ?? {
    activeEnv: DEFAULT_ENV,
    environments: { [DEFAULT_ENV]: buildSnapshot(getSettings()) },
    versions: [],
  };
  // Seed an initial version for the active env if history is empty.
  if (state.versions.length === 0) {
    state.versions.push({ id: nextId(), env: state.activeEnv, at: new Date().toISOString(), snapshot: structuredClone(state.environments[state.activeEnv]), label: "initial", knownGood: true });
    persist();
  }
  return state;
}

function record(env: string, snapshot: ConfigSnapshot, label?: string): ConfigVersion {
  const s = ensure();
  const version: ConfigVersion = { id: nextId(), env, at: new Date().toISOString(), snapshot: structuredClone(snapshot), label, knownGood: false };
  s.versions.push(version);
  if (s.versions.length > MAX_VERSIONS) s.versions.splice(0, s.versions.length - MAX_VERSIONS);
  return version;
}

/** The current config state as JSON (decrypted) — what an export bundle wraps. */
export function serializeState(): string {
  return JSON.stringify({ ...ensure(), counter }, null, 2);
}

/**
 * Securely export the config: re-encrypt the decrypted state under a one-time ephemeral
 * key, then ROTATE the internal key and re-seal the on-disk store under the new version.
 * Returns the portable bundle + its ephemeral key (the only secret that leaves). The
 * internal at-rest key is never exported and changes after every export.
 */
export function exportConfig(): ExportedBundle {
  const out = exportConfigBundle(serializeState());
  persist(); // re-seal the live store under the just-rotated internal key
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface StoreView {
  activeEnv: string;
  environments: string[];
  versions: ConfigVersion[];
  lastKnownGoodId: string | null;
  persisted: boolean;
}

/** The store summary for the UI: active env, env names, versions (newest first),
 *  the last known-good id, and whether it's disk-persisted. */
export function storeView(): StoreView {
  const s = ensure();
  return {
    activeEnv: s.activeEnv,
    environments: Object.keys(s.environments),
    versions: [...s.versions].reverse(), // newest first
    lastKnownGoodId: lastKnownGood(s.activeEnv)?.id ?? null,
    persisted: store.enabled,
  };
}

/** Capture the current settings as a new version of the active environment. */
export function captureVersion(label?: string): ConfigVersion {
  const s = ensure();
  const snapshot = buildSnapshot(getSettings());
  s.environments[s.activeEnv] = structuredClone(snapshot);
  const v = record(s.activeEnv, snapshot, label);
  persist();
  return v;
}

/** Create a named environment, seeded by cloning the active env's current config. */
export function createEnvironment(name: string): StoreView {
  const s = ensure();
  if (!name || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error("Invalid environment name");
  if (s.environments[name]) throw new Error(`Environment "${name}" already exists`);
  // Clone the active env's current config as the new environment's starting point.
  s.environments[name] = structuredClone(s.environments[s.activeEnv]);
  record(name, s.environments[name], `created from ${s.activeEnv}`);
  persist();
  return storeView();
}

/** Switch the active environment and apply its config to the live settings. */
export function activateEnvironment(name: string): StoreView {
  const s = ensure();
  if (!s.environments[name]) throw new Error(`Unknown environment "${name}"`);
  s.activeEnv = name;
  // Apply the target environment's config to the live settings.
  updateSettings(applySnapshot(s.environments[name]).patch);
  record(name, s.environments[name], "activated");
  persist();
  return storeView();
}

/** Flag a version as known-good (a safe rollback target). */
export function markKnownGood(id: string): StoreView {
  const s = ensure();
  const v = s.versions.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown version "${id}"`);
  v.knownGood = true;
  persist();
  return storeView();
}

/** The most recent known-good version for an environment, or null if none. */
export function lastKnownGood(env: string): ConfigVersion | null {
  const s = ensure();
  for (let i = s.versions.length - 1; i >= 0; i--) {
    if (s.versions[i].env === env && s.versions[i].knownGood) return s.versions[i];
  }
  return null;
}

/** Roll the active environment's live settings back to a specific version. */
export function rollbackTo(id: string): { applied: ConfigVersion; warnings: string[] } {
  const s = ensure();
  const target = s.versions.find((x) => x.id === id);
  if (!target) throw new Error(`Unknown version "${id}"`);
  const { patch, warnings } = applySnapshot(target.snapshot);
  updateSettings(patch);
  s.activeEnv = target.env;
  s.environments[target.env] = structuredClone(target.snapshot);
  record(target.env, target.snapshot, `rollback to ${id}`);
  persist();
  return { applied: target, warnings };
}

/** One-click rollback of the active environment to its last known-good version. */
export function rollbackToLastKnownGood(): { applied: ConfigVersion; warnings: string[] } {
  const s = ensure();
  const good = lastKnownGood(s.activeEnv);
  if (!good) throw new Error(`No known-good version for "${s.activeEnv}"`);
  return rollbackTo(good.id);
}

/** Copy one environment's config onto another (e.g. promote sandbox → production). */
export function promote(from: string, to: string): StoreView {
  const s = ensure();
  if (!s.environments[from]) throw new Error(`Unknown environment "${from}"`);
  if (!s.environments[to]) throw new Error(`Unknown environment "${to}"`);
  s.environments[to] = structuredClone(s.environments[from]);
  record(to, s.environments[to], `promoted from ${from}`);
  if (s.activeEnv === to) updateSettings(applySnapshot(s.environments[to]).patch);
  persist();
  return storeView();
}

/** Test-only: reset the in-memory store. */
export function __resetConfigStore(): void {
  state = null;
  counter = 0;
}
