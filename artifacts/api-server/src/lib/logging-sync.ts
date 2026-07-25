import { assertSafeOutboundUrl, isSafeOutboundUrl, UnsafeUrlError } from "./url-safety";
import { SettingsValidationError } from "./settings";
import { readConfigCollection, type ConfigScopes } from "./scoped-config";

/**
 * LOGGING SYNC — the opt-in egress of the gateway's own event log to an external destination. It's the classic
 * "disclose, don't insure" egress: turning it ON moves a copy of data off the deployment, so it is SECURITY-
 * classified (§0) and governed by the floor gate — enabling (or redirecting) it is held for a signed sign-off.
 *
 * It moved out of `SettingsState` into the composition model as the `logging-sync` config def (roadmap Phase C).
 * Resolution: org config def → env base layer (`LOGGING_SYNC_URL` / `LOGGING_SYNC_ACK_WARRANTY`) → off. The env
 * layer is a deploy-time default (an operator can seed it), not a compat bridge.
 */
export interface LoggingSyncConfig {
  enabled: boolean;
  url: string | null;
  /** The admin acknowledged that egressed data leaves OmniProject's warranty. */
  acknowledgedWarranty: boolean;
}

export const LOGGING_SYNC_CONFIG_ID = "logging-sync";

/** The deploy-time BASE layer from env. Operator-trusted, but still drop an unsafe URL and only enable when the
 *  warranty was explicitly acknowledged via env. */
export function loggingSyncFromEnv(): LoggingSyncConfig {
  const url = process.env["LOGGING_SYNC_URL"]?.trim() || null;
  const ack = process.env["LOGGING_SYNC_ACK_WARRANTY"] === "true";
  const safe = url ? isSafeOutboundUrl(url) : false;
  return { enabled: !!url && safe && ack, url: safe ? url : null, acknowledgedWarranty: ack };
}

/**
 * Validate + normalise the opt-in logging-sync egress config: an object with an optional safe-outbound `url`;
 * turning it ON requires BOTH a url and an explicit warranty acknowledgement (egress is the one out-of-warranty
 * relaxation). Returns the clean {@link LoggingSyncConfig}; throws {@link SettingsValidationError} (→ 400) on bad
 * input. The route carries this as the config-mode validator (settings validation used to live in `updateSettings`).
 */
export function sanitizeLoggingSync(value: unknown): LoggingSyncConfig {
  if (!value || typeof value !== "object") throw new SettingsValidationError("loggingSync must be an object");
  const { enabled, url, acknowledgedWarranty } = value as Record<string, unknown>;
  if (url != null) {
    if (typeof url !== "string") throw new SettingsValidationError("loggingSync.url must be a string or null");
    try {
      assertSafeOutboundUrl(url, "loggingSync.url");
    } catch (err) {
      throw new SettingsValidationError(err instanceof UnsafeUrlError ? err.message : "loggingSync.url is invalid");
    }
  }
  if (enabled === true) {
    if (typeof url !== "string" || !url) throw new SettingsValidationError("enable the logging sync requires a url");
    if (acknowledgedWarranty !== true) {
      throw new SettingsValidationError("enabling the logging sync requires acknowledging that egressed data is outside OmniProject's warranty");
    }
  }
  return { enabled: enabled === true, url: (url as string | null | undefined) ?? null, acknowledgedWarranty: acknowledgedWarranty === true };
}

/** The resolved logging-sync config (org config def → env base → off). */
export function resolveLoggingSync(scopes: ConfigScopes = {}): LoggingSyncConfig {
  return readConfigCollection<LoggingSyncConfig>(LOGGING_SYNC_CONFIG_ID, loggingSyncFromEnv(), scopes);
}

/** True when historical time-travel is available (operator opted into the log-sync egress). */
export function isTimeTravelEnabled(): boolean {
  return resolveLoggingSync().enabled;
}
