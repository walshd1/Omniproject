/**
 * The single home for resolving the configured broker URL — including the deprecated
 * pre-0.2.0 `N8N_WEBHOOK_URL` alias. Centralised here (a broker-NEUTRAL helper) so that the
 * legacy vendor-named env key lives in exactly ONE place: callers ask for "the broker URL", not
 * for a vendor-specific variable. The broker isolation guard relies on this being the only
 * non-`broker/n8n/` site that mentions the alias.
 */

/** The configured broker base URL (first non-empty of BROKER_URL, the first of BROKER_URLS, or
 *  the legacy N8N_WEBHOOK_URL alias), trimmed — or undefined when none is set. */
export function configuredBrokerUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = [env["BROKER_URL"], env["BROKER_URLS"]?.split(",")[0], env["N8N_WEBHOOK_URL"]];
  for (const c of candidates) {
    const t = c?.trim();
    if (t) return t;
  }
  return undefined;
}
