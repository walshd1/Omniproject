import type { SettingsState } from "./settings";

/**
 * Config snapshot / backup-restore.
 *
 * OmniProject is stateless, so the only thing worth snapshotting is the gateway
 * *configuration* it holds at runtime (the settings store). A snapshot is a
 * small, portable JSON you can take before a risky change and restore if a port
 * or setup goes wrong. Durable secrets (SESSION_SECRET, OIDC_CLIENT_SECRET,
 * NOTIFY_INGEST_SECRET, REDIS_URL) live in the environment and are deliberately
 * NOT included — pair this with the env config export to move a whole instance.
 *
 * Pure + side-effect free so it's unit-tested.
 */

export const SNAPSHOT_SCHEMA = "omniproject/config-snapshot";
export const SNAPSHOT_VERSION = 1;

const SNAPSHOT_KEYS = ["n8nWebhookUrl", "aiProvider", "aiModel", "backendSource", "oidcIssuerUrl"] as const;
type SnapshotKey = (typeof SNAPSHOT_KEYS)[number];

export interface ConfigSnapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  version: number;
  createdAt: string;
  settings: Pick<SettingsState, SnapshotKey>;
}

export function buildSnapshot(settings: SettingsState): ConfigSnapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    settings: {
      n8nWebhookUrl: settings.n8nWebhookUrl,
      aiProvider: settings.aiProvider,
      aiModel: settings.aiModel,
      backendSource: settings.backendSource,
      oidcIssuerUrl: settings.oidcIssuerUrl,
    },
  };
}

/**
 * Validate a snapshot and produce a settings patch to apply. Throws on a
 * structurally invalid snapshot; collects non-fatal issues as warnings.
 */
export function applySnapshot(input: unknown): { patch: Record<string, unknown>; warnings: string[] } {
  const warnings: string[] = [];
  if (!input || typeof input !== "object") throw new Error("Snapshot must be a JSON object");

  const snap = input as Partial<ConfigSnapshot> & { settings?: Record<string, unknown> };
  if (snap.schema !== SNAPSHOT_SCHEMA) throw new Error(`Unrecognised snapshot schema: ${String(snap.schema)}`);
  if (snap.version !== SNAPSHOT_VERSION) warnings.push(`Snapshot version ${String(snap.version)} differs from ${SNAPSHOT_VERSION}; applying best-effort`);

  const s = snap.settings;
  if (!s || typeof s !== "object") throw new Error("Snapshot is missing a settings object");

  const patch: Record<string, unknown> = {};
  for (const key of SNAPSHOT_KEYS) {
    if (key in s) patch[key] = (s as Record<string, unknown>)[key];
    else warnings.push(`Snapshot omits "${key}" — left unchanged`);
  }
  for (const key of Object.keys(s)) {
    if (!(SNAPSHOT_KEYS as readonly string[]).includes(key)) warnings.push(`Ignored unknown setting "${key}"`);
  }
  return { patch, warnings };
}
