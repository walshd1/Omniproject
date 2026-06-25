/**
 * Small, dependency-free input validators shared by the settings / setup forms.
 * These produce inline field feedback; they never relax any server-side checks.
 */

/**
 * Returns an error message when `value` is a non-empty string that is not a
 * valid absolute http(s) URL. Empty values are treated as valid (use a separate
 * required check where a URL is mandatory).
 */
export function urlFormatError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a valid URL (including http:// or https://).";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "URL must start with http:// or https://.";
  }
  return null;
}

/** Allowed environment name: letters, digits, dash and underscore; no spaces. */
const ENV_NAME_RE = /^[a-z0-9_-]+$/i;

/**
 * Returns an error message when an environment name is empty or contains
 * characters other than letters, digits, dashes or underscores.
 */
export function envNameError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an environment name.";
  if (!ENV_NAME_RE.test(trimmed)) {
    return "Use letters, numbers, dashes or underscores only — no spaces.";
  }
  return null;
}
