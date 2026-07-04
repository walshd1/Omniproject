/**
 * The single home for resolving configured broker endpoints — including the deprecated pre-0.2.0
 * `N8N_WEBHOOK_URL` alias. Centralised here (a broker-NEUTRAL helper) so callers ask for "the
 * broker URL(s)", not for a vendor-specific variable, and so checks reference EVERY loaded broker
 * rather than singling one out. The broker-isolation guard relies on this being the only
 * non-`broker/reference-broker/` site that mentions the alias.
 */

/** Every configured broker endpoint URL across ALL loaded brokers — the default `BROKER_URL`, any
 *  `BROKER_URLS` pool, every per-kind URL in `BROKER_ENDPOINTS` (`kind=url|url,kind2=url`), and the
 *  deprecated `N8N_WEBHOOK_URL` alias — trimmed and de-duplicated, in that precedence order. The
 *  security + egress checks iterate this so a plaintext/unpinned endpoint on ANY connected broker
 *  is caught, not just the primary. */
export function configuredBrokerUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const urls: string[] = [];
  const push = (v: string | undefined) => {
    const t = v?.trim();
    if (t) urls.push(t);
  };
  push(env["BROKER_URL"]);
  for (const u of env["BROKER_URLS"]?.split(",") ?? []) push(u);
  // Per-kind endpoints: "kind=url|url,kind2=url" — gather every URL across every kind.
  for (const pair of env["BROKER_ENDPOINTS"]?.split(",") ?? []) {
    const eq = pair.indexOf("=");
    const list = eq >= 0 ? pair.slice(eq + 1) : pair;
    for (const u of list.split("|")) push(u);
  }
  push(env["N8N_WEBHOOK_URL"]); // deprecated alias for BROKER_URL
  return [...new Set(urls)];
}

/** The primary configured broker base URL (the first of {@link configuredBrokerUrls}), or
 *  undefined when none is set. For single-endpoint callers (the active adapter, "is a backend
 *  wired?"); checks that must cover every broker use {@link configuredBrokerUrls}. */
export function configuredBrokerUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return configuredBrokerUrls(env)[0];
}
