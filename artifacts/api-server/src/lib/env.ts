/**
 * Tiny environment-variable helpers, so the same parsing isn't re-spelled at each read site.
 */

/** Is this env var set to a truthy flag (1/true/on/yes, case-insensitive)? Unset ⇒ false. */
export function envFlag(name: string): boolean {
  return /^(1|true|on|yes)$/i.test(process.env[name]?.trim() ?? "");
}
