import crypto from "node:crypto";

/**
 * Content-Security-Policy for the served SPA. The default is strict but SPA-compatible
 * (scripts only from same-origin, no framing, no plugins); it's fully overridable so a
 * deployment with extra asset origins (a CDN logo host, an external font) can tune it
 * without a code change.
 *
 *   CONTENT_SECURITY_POLICY  — full override string (used verbatim if set)
 *   CSP_IMG_SRC / CSP_CONNECT_SRC / CSP_STYLE_SRC / CSP_SCRIPT_SRC — append extra sources
 *   CSP_REPORT_ONLY=1        — emit Content-Security-Policy-Report-Only (observe, don't block)
 *   CSP_REPORT_URI           — where violation reports are POSTed (adds report-uri/report-to)
 *
 * A per-request nonce is added to `script-src` (defence-in-depth): the SPA is served as
 * external same-origin bundles ('self' already covers them), so the nonce is additive —
 * it lets a future inline <script> be allowlisted by nonce instead of reopening
 * 'unsafe-inline'. NOTE: `style-src` deliberately keeps 'unsafe-inline' and is NOT given a
 * nonce — CSP nonces cover <style> ELEMENTS but never inline `style="…"` ATTRIBUTES, which
 * React/Tailwind emit throughout, and adding a nonce/hash to a directive makes the browser
 * IGNORE 'unsafe-inline' there, which would break the SPA's styling.
 */

/** A fresh base64 CSP nonce (16 bytes of entropy) for a single response. */
export function cspNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}
const DEFAULTS: Record<string, string> = {
  "default-src": "'self'",
  "base-uri": "'self'",
  "object-src": "'none'",
  "frame-ancestors": "'none'",
  // No third-party framing by default. A deployment that turns on native-handoff EMBED (Tier-2) sets
  // CSP_FRAME_SRC to the exact vendor embed hosts it uses (e.g. "https://miro.com https://app.powerbi.com").
  "frame-src": "'none'",
  "form-action": "'self'",
  // Inline styles are needed by the SPA's styling; scripts stay same-origin only.
  "script-src": "'self'",
  "style-src": "'self' 'unsafe-inline'",
  // Logos/avatars may be data/blob or an https host (branding); fonts may be data URIs.
  "img-src": "'self' data: blob: https:",
  "font-src": "'self' data:",
  "connect-src": "'self'",
  "worker-src": "'self' blob:",
  "manifest-src": "'self'",
};

const EXTRA_ENV: Record<string, string> = {
  "img-src": "CSP_IMG_SRC",
  "connect-src": "CSP_CONNECT_SRC",
  "style-src": "CSP_STYLE_SRC",
  "script-src": "CSP_SCRIPT_SRC",
  "frame-src": "CSP_FRAME_SRC",
};

/** Build the CSP policy string (env override wins; else the strict default + any extras).
 *  When `nonce` is supplied it is added to `script-src` as a per-request allowlist. */
export function contentSecurityPolicy(nonce?: string): string {
  const override = process.env["CONTENT_SECURITY_POLICY"]?.trim();
  if (override) return override;
  const directives: Record<string, string> = { ...DEFAULTS };
  for (const [directive, envName] of Object.entries(EXTRA_ENV)) {
    const extra = process.env[envName]?.trim();
    if (!extra) continue;
    // A directive that defaults to 'none' (e.g. frame-src) must be REPLACED — appending a source to
    // 'none' is invalid CSP. Otherwise the extra sources are appended to the existing allowlist.
    directives[directive] = directives[directive] === "'none'" ? extra : `${directives[directive]} ${extra}`.trim();
  }
  if (nonce) directives["script-src"] = `${directives["script-src"]} 'nonce-${nonce}'`.trim();
  const reportUri = process.env["CSP_REPORT_URI"]?.trim();
  if (reportUri) directives["report-uri"] = reportUri;
  return Object.entries(directives).map(([k, v]) => `${k} ${v}`).join("; ");
}

/** The header name to use — report-only when CSP_REPORT_ONLY is set (observe without blocking). */
export function cspHeaderName(): string {
  const ro = process.env["CSP_REPORT_ONLY"]?.trim();
  return ro && ro !== "0" && ro.toLowerCase() !== "false"
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";
}
