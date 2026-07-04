/**
 * Tiny environment-variable helpers, so the same parsing isn't re-spelled at each read site.
 */
import { envBool } from "./env-config";

/** Is this env var set to a truthy flag (1/true/on/yes, case-insensitive)? Unset ⇒ false. */
export function envFlag(name: string): boolean {
  return envBool(name);
}

/** Parse a comma-separated env value into a lower-cased `Set` (the recurring "role list" /
 *  "value list" shape) — trimmed, empty entries dropped. `fallback` is used verbatim (also
 *  lower-cased/deduped via `Set`) when `raw` is unset/blank. */
export function parseCommaSet(raw: string | undefined, fallback: string[] = []): Set<string> {
  const list = raw?.trim() ? raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : fallback;
  return new Set(list.map((s) => s.toLowerCase()));
}

/** Parse a comma-separated env value into a trimmed, non-empty string list — order preserved,
 *  no case-folding/dedup (callers apply that themselves when it matters, e.g. hostname
 *  case-insensitivity). Empty/unset ⇒ []. */
export function parseCsvEnv(name: string): string[] {
  return (process.env[name]?.trim() || "").split(",").map((s) => s.trim()).filter(Boolean);
}
