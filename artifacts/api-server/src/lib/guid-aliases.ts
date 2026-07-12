/**
 * GUID TRANSLATION — the alias table that lets an admin RELINK a project to a new correlation GUID
 * without losing the history that referenced the old one.
 *
 * OmniProject identifies a project by its correlation GUID (`omniInstanceId`). If a project is
 * re-created (moved to a new backend, re-instantiated, merged), it gets a NEW GUID — but programmes,
 * the closed-project index and historical reports still carry the OLD one. This table maps
 * `oldGuid → newGuid`, and `resolveGuid` follows the chain so every reference to a superseded GUID
 * resolves to the project's current identity. Sealed at rest with the rest of settings.
 */

export type GuidAliases = Record<string, string>;

export class GuidAliasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuidAliasError";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate + normalise the alias table (trim, drop blanks, reject self-aliases and direct cycles). */
export function validateGuidAliases(value: unknown): GuidAliases {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GuidAliasError("guidAliases must be an object of oldGuid → newGuid");
  }
  const out: GuidAliases = {};
  for (const [rawOld, rawNew] of Object.entries(value)) {
    const oldGuid = str(rawOld);
    const newGuid = str(rawNew);
    if (!oldGuid) throw new GuidAliasError("alias source GUID must be non-empty");
    if (!newGuid) throw new GuidAliasError(`alias for "${oldGuid}" must map to a non-empty GUID`);
    if (oldGuid === newGuid) throw new GuidAliasError(`alias "${oldGuid}" cannot point at itself`);
    out[oldGuid] = newGuid;
  }
  // Reject cycles: following every alias must terminate (else resolveGuid could loop on bad data).
  for (const start of Object.keys(out)) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur && out[cur]) {
      if (seen.has(cur)) throw new GuidAliasError(`alias chain from "${start}" forms a cycle`);
      seen.add(cur);
      cur = out[cur];
    }
  }
  return out;
}

/**
 * Resolve a GUID to its current identity by following the alias chain (`old → … → current`). A GUID with
 * no alias returns unchanged. Safe on any input: a visited-set guarantees termination even if the table
 * somehow contains a cycle (validation rejects cycles, but resolution must never loop).
 */
export function resolveGuid(guid: string, aliases: GuidAliases): string {
  let current = guid;
  const seen = new Set<string>();
  let next = aliases[current];
  while (next && !seen.has(current)) {
    seen.add(current);
    current = next;
    next = aliases[current];
  }
  return current;
}
