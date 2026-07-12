import { getBrokerDef } from "@workspace/backend-catalogue";

/**
 * Admin-managed connected-broker kinds — the broker platforms wired below the seam beyond the active
 * data hop. The admin `brokerKinds` setting is the SINGLE SOURCE OF TRUTH (sealed at rest); the
 * `BROKER_KINDS` env only SEEDS the initial default at first boot, after which the setting fully owns
 * the list (an admin can add and remove freely). Each kind must exist in the broker catalogue.
 */

export class BrokerKindsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerKindsError";
  }
}

/** Validate + normalise (trim, lowercase, dedupe) the admin broker-kind list against the catalogue.
 *  An unknown id throws, so the admin gets immediate feedback instead of a silent drop. */
export function validateBrokerKinds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new BrokerKindsError("brokerKinds must be an array");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") throw new BrokerKindsError("each broker kind must be a string");
    const kind = raw.trim().toLowerCase();
    if (!kind) continue;
    if (!getBrokerDef(kind)) throw new BrokerKindsError(`unknown broker kind "${kind}" — not in the broker catalogue`);
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push(kind);
  }
  return out;
}

/** The SEED default from the `BROKER_KINDS` env (comma list), for first-boot only. Unknown ids are
 *  dropped silently here (it's ops-provided config, not interactive input); the setting owns it after. */
export function brokerKindsFromEnv(): string[] {
  const raw = process.env["BROKER_KINDS"]?.trim();
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const kind = part.trim().toLowerCase();
    if (!kind || seen.has(kind) || !getBrokerDef(kind)) continue;
    seen.add(kind);
    out.push(kind);
  }
  return out;
}
