import { getBrokerDef } from "@workspace/backend-catalogue";

/**
 * Admin-managed connected-broker kinds. Which broker platforms are wired below the seam (beyond the
 * active data hop) was env-only (`BROKER_KINDS`); this makes it an admin setting too, sealed at rest
 * with the rest of the config. The two sources union in the registry, so env-declared kinds keep
 * working and an admin can add more. Each kind must exist in the broker catalogue (an unknown id is
 * rejected here so the admin gets immediate feedback, rather than being silently dropped later).
 */

export class BrokerKindsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerKindsError";
  }
}

/** Validate + normalise (trim, lowercase, dedupe) the admin broker-kind list against the catalogue. */
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
