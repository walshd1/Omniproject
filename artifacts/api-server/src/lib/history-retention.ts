import { isValidCadence, type HistoryRetentionConfig } from "../history/cadence";
import { SettingsValidationError } from "./settings";
import { readConfigCollection, type ConfigScopes } from "./scoped-config";

/**
 * HISTORY RETENTION — the durable-snapshot cadence (org default + PMO programme/project overrides) plus the
 * org-wide DISPOSAL window (`retentionDays`) and LEGAL HOLDS. It moved out of `SettingsState` into the
 * composition model as the `history-retention` config def (roadmap Phase C). The disposal window is SECURITY-
 * classified: SHORTENING it loses audit trail (a relaxation), so a shortening write is held for a signed
 * sign-off via the floor gate — its predicate lives in `security-config`. Lengthening / cadence edits apply
 * immediately. Resolution is org config def → the built-in default (daily cadence, infinite retention).
 */
export interface HistoryRetentionSettings extends HistoryRetentionConfig {
  /** DISPOSAL window in days: snapshots/journal older than this become prunable. Absent/null ⇒ INFINITE. */
  retentionDays?: number | null;
  /** LEGAL-HOLD keys (`"entity#id"`) exempt from BOTH disposal and erasure until released. */
  legalHolds?: string[];
}

export const DEFAULT_HISTORY_RETENTION: HistoryRetentionSettings = {
  orgDefault: { kind: "interval", everyHours: 24 },
  programme: {},
  project: {},
};

/**
 * Validate + normalise the retention config: valid cadences for the org default and every programme/project
 * override; a positive-integer-or-null disposal window; a string[] of legal holds. Returns the clean object;
 * throws {@link SettingsValidationError} (→ 400) on bad input. Carried by the route (validation used to live in
 * `updateSettings`).
 */
export function sanitizeHistoryRetention(value: unknown): HistoryRetentionSettings {
  if (!value || typeof value !== "object") throw new SettingsValidationError("historyRetention must be an object");
  const { orgDefault, programme, project, retentionDays, legalHolds } = value as Record<string, unknown>;
  if (!isValidCadence(orgDefault)) {
    throw new SettingsValidationError("historyRetention.orgDefault must be a valid cadence (onWrite | manual | interval{everyHours})");
  }
  const cleanMap = (name: string, map: unknown): Record<string, ReturnType<typeof asCadence>> => {
    if (map === undefined) return {};
    if (!map || typeof map !== "object") throw new SettingsValidationError(`historyRetention.${name} must be an object`);
    const out: Record<string, ReturnType<typeof asCadence>> = {};
    for (const [key, cadence] of Object.entries(map as Record<string, unknown>)) {
      // Inline proto-key guard (a programme/project id is the map key): never write __proto__/constructor/prototype.
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (!isValidCadence(cadence)) throw new SettingsValidationError(`historyRetention.${name}.${key} must be a valid cadence`);
      out[key] = asCadence(cadence);
    }
    return out;
  };
  if (retentionDays !== undefined && retentionDays !== null) {
    if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new SettingsValidationError("historyRetention.retentionDays must be a positive integer (or null for infinite retention)");
    }
  }
  if (legalHolds !== undefined) {
    if (!Array.isArray(legalHolds) || legalHolds.some((k) => typeof k !== "string")) {
      throw new SettingsValidationError("historyRetention.legalHolds must be an array of \"entity#id\" strings");
    }
  }
  return {
    orgDefault: asCadence(orgDefault),
    programme: cleanMap("programme", programme),
    project: cleanMap("project", project),
    ...(retentionDays !== undefined ? { retentionDays: retentionDays as number | null } : {}),
    ...(legalHolds !== undefined ? { legalHolds: legalHolds as string[] } : {}),
  };
}

// `isValidCadence` is a type guard, so a validated value already narrows to SnapshotCadence.
function asCadence(v: unknown): HistoryRetentionConfig["orgDefault"] {
  return v as HistoryRetentionConfig["orgDefault"];
}

export const HISTORY_RETENTION_CONFIG_ID = "history-retention";

/** The resolved retention config (org config def → built-in default). */
export function resolveHistoryRetention(scopes: ConfigScopes = {}): HistoryRetentionSettings {
  return readConfigCollection<HistoryRetentionSettings>(HISTORY_RETENTION_CONFIG_ID, DEFAULT_HISTORY_RETENTION, scopes);
}

/** The org disposal window in days, or `null` for infinite retention. */
export function retentionDaysNow(): number | null {
  return resolveHistoryRetention().retentionDays ?? null;
}

/** The org legal-hold key set (`"entity#id"`). */
export function legalHoldsNow(): string[] {
  return resolveHistoryRetention().legalHolds ?? [];
}
