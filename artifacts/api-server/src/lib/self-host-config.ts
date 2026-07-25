import { SettingsValidationError } from "./settings";
import { readConfigCollection, type ConfigScopes } from "./scoped-config";

/**
 * SELF-HOST DB ADOPTION — the operator's choice to let OmniProject's OWN database become a system-of-record (or
 * an augmenting store) for a slice of the work-item superset. It moved out of `SettingsState` into the
 * composition model as the `self-host` config def (roadmap Phase C).
 *
 * NB it is a CHOICE config, NOT floor-gated. Its real security control is the "disclose, don't insure"
 * ACKNOWLEDGEMENT (a non-off mode without it is rejected — `sanitizeSelfHost`), enforced on the setup route; it
 * is authored through the admin setup wizard (`POST /api/setup/self-host`), which has always applied
 * immediately (never a sign-off). Its former `SECURITY_SETTINGS` `changed` classification only guarded the bulk
 * `PATCH /settings` backdoor — and once it leaves settings that path can no longer reach it at all. Resolution is
 * org config def → the built-in default (off, nothing adopted).
 */
export interface SelfHostConfig {
  mode: "off" | "augmenting" | "system-of-record";
  /** Gated domain ids opted into at org level (e.g. "financials", "quality"). Core is implicit. */
  adopted: string[];
  /** The admin acknowledged that self-host data is theirs to own, secure and back up. */
  acknowledgedDataResponsibility: boolean;
}

export const SELF_HOST_MODES = ["off", "augmenting", "system-of-record"] as const;
export const DEFAULT_SELF_HOST: SelfHostConfig = { mode: "off", adopted: [], acknowledgedDataResponsibility: false };

/**
 * Validate + normalise the self-host adoption config: a valid mode, a string[] of adopted domain ids, and — the
 * "disclose, don't insure" gate — an explicit acknowledgement whenever the mode isn't `off`. Returns the clean
 * object; throws {@link SettingsValidationError} (→ 400) on bad input.
 */
export function sanitizeSelfHost(value: unknown): SelfHostConfig {
  if (!value || typeof value !== "object") throw new SettingsValidationError("selfHost must be an object");
  const { mode, adopted, acknowledgedDataResponsibility } = value as Record<string, unknown>;
  if (!(SELF_HOST_MODES as readonly string[]).includes(mode as string)) {
    throw new SettingsValidationError(`selfHost.mode must be one of: ${SELF_HOST_MODES.join(", ")}`);
  }
  if (!Array.isArray(adopted) || adopted.some((x) => typeof x !== "string")) {
    throw new SettingsValidationError("selfHost.adopted must be an array of strings");
  }
  if (typeof acknowledgedDataResponsibility !== "boolean") {
    throw new SettingsValidationError("selfHost.acknowledgedDataResponsibility must be a boolean");
  }
  if (mode !== "off" && acknowledgedDataResponsibility !== true) {
    throw new SettingsValidationError(
      "enabling self-host storage requires acknowledging that the data is yours to own, secure and back up (outside OmniProject's warranty)",
    );
  }
  return { mode: mode as SelfHostConfig["mode"], adopted: adopted as string[], acknowledgedDataResponsibility };
}

export const SELF_HOST_CONFIG_ID = "self-host";

/** The resolved self-host adoption config (org config def → built-in default). */
export function resolveSelfHost(scopes: ConfigScopes = {}): SelfHostConfig {
  return readConfigCollection<SelfHostConfig>(SELF_HOST_CONFIG_ID, DEFAULT_SELF_HOST, scopes);
}
