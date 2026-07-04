/**
 * Decode a PEM-ish env value that may be supplied either as raw PEM or as base64-of-PEM
 * (env-friendly — no embedded newlines). Shared by every credential that accepts both forms
 * (SAML IdP certs, license keys): trim, accept as-is if it already carries `marker`, otherwise
 * try a base64 decode and accept the decoded text if THAT carries `marker`. When neither works,
 * `fallbackToRawOnFail` decides whether to hand back the trimmed raw value (some consumers, e.g.
 * node-saml, accept a bare base64 cert body with no PEM markers at all) or fail with `null`.
 */
export function decodePemOrBase64(raw: string | undefined, marker: string, fallbackToRawOnFail: boolean): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (v.includes(marker)) return v;
  try {
    const decoded = Buffer.from(v, "base64").toString("utf8");
    if (decoded.includes(marker)) return decoded;
  } catch {
    /* not base64 */
  }
  return fallbackToRawOnFail ? v : null;
}
