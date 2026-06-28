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
 */
const DEFAULTS: Record<string, string> = {
  "default-src": "'self'",
  "base-uri": "'self'",
  "object-src": "'none'",
  "frame-ancestors": "'none'",
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
};

/** Build the CSP policy string (env override wins; else the strict default + any extras). */
export function contentSecurityPolicy(): string {
  const override = process.env["CONTENT_SECURITY_POLICY"]?.trim();
  if (override) return override;
  const directives: Record<string, string> = { ...DEFAULTS };
  for (const [directive, envName] of Object.entries(EXTRA_ENV)) {
    const extra = process.env[envName]?.trim();
    if (extra) directives[directive] = `${directives[directive]} ${extra}`.trim();
  }
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
