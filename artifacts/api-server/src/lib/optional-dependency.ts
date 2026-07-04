import { logger } from "./logger";

/**
 * Runtime-optional dependency loader — the shared shape behind every "this package isn't a
 * committed dependency, load it if present, degrade to a no-op if not" seam (Redis clients,
 * the SAML library, geoip-lite, …): dynamic `import()` by a variable specifier (so bundlers/tsc
 * never statically resolve it), extract the piece the caller needs, and on absence/mismatch log
 * ONE warning and resolve to `null` — never throw. The caller decides what "absent" means for
 * its feature (a no-op check, a per-replica fallback, …); this only owns the load-and-warn part.
 */
export async function loadOptionalDependency<T>(
  pkgName: string,
  extract: (mod: unknown) => T | null | undefined,
  warnMessage: string,
): Promise<T | null> {
  const mod = await import(pkgName).catch(() => null);
  const value = mod ? extract(mod) : undefined;
  if (value === null || value === undefined) {
    logger.warn(warnMessage);
    return null;
  }
  return value;
}
