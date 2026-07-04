/**
 * Egress / SSRF guard for the gateway's outbound HTTP.
 *
 * The headline this prevents is the Capital-One pattern: a server-side request
 * coerced to the cloud **metadata endpoint** (169.254.169.254 → IAM creds → data
 * lake). OmniProject legitimately calls *internal* hosts (n8n on the container
 * network, a self-hosted logging server), so a blanket private-range block would
 * break normal deployments. Instead:
 *
 *   - **Always blocked:** link-local / cloud-metadata targets (169.254.0.0/16,
 *     IPv6 fe80::/10 and fd00:ec2::254, IPv4-mapped IPv6 forms of the above, and
 *     the metadata.google.internal / metadata hostnames) — checked both against
 *     the URL's literal hostname AND, when it's a plain (non-IP) name, against
 *     every address it actually resolves to. The latter closes the classic
 *     SSRF-via-DNS bypass: an attacker-controlled domain that simply *resolves*
 *     to the metadata IP would sail past a hostname-string-only check. Nothing
 *     legitimate ever needs to reach these addresses through the app, so
 *     blocking them is free.
 *   - **Always blocked:** non-http(s) schemes (file:, gopher:, etc.).
 *   - **Optional strict mode:** set `EGRESS_ALLOWLIST` to a comma-separated host
 *     list and ALL outbound hosts must match — for deployments that want to pin
 *     egress to exactly their broker/IdP/FX hosts.
 *   - **Per-country residency:** when a `DATA_RESIDENCY_POLICY` is configured, the
 *     host must also sit in an allowed region's egress allowlist, else the hop is
 *     refused with a `DataResidencyError` (451). Inert when no policy is set.
 *
 * The range checks live in `lib/ip-ranges.ts` (byte/hextet-level containment, not
 * regex-against-the-raw-string), shared with `lib/url-safety.ts` so both guards
 * agree on exactly what "link-local/metadata" means.
 *
 * Use `safeFetch` everywhere the gateway makes an outbound request.
 */
import dns from "node:dns/promises";
import net from "node:net";
import { assertEgressResidency } from "./data-residency";
import { isBlockedHostLiteral, isBlockedIp } from "./ip-ranges";
import { parseCsvEnv } from "./env";

export class EgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressError";
  }
}

export type LookupFn = (hostname: string, options: { all: true; verbatim: true }) => Promise<{ address: string; family: number }[]>;

/**
 * Validate a URL is allowed for server-side egress; throws EgressError if not.
 * Returns the parsed URL on success. ASYNC: a plain (non-IP-literal) hostname is
 * resolved via DNS and every returned address is checked too — a literal-hostname-
 * only check cannot catch a name that simply resolves to the metadata IP.
 *
 * Fails CLOSED on a DNS resolution error (can't confirm the target is safe ⇒
 * refuse) rather than falling through to the fetch, which would just hit the
 * same resolver moments later anyway.
 *
 * `lookup` is injectable (defaults to `dns.lookup`) purely so tests can supply a
 * deterministic resolver instead of depending on real network/DNS.
 */
export async function assertEgressAllowed(rawUrl: string, lookup: LookupFn = dns.lookup): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new EgressError("egress target is not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new EgressError(`egress scheme "${u.protocol}" is not allowed (http/https only)`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase(); // strip IPv6 brackets
  if (isBlockedHostLiteral(host)) {
    throw new EgressError(`egress to ${host} is blocked (link-local/metadata range)`);
  }
  // A plain hostname (not already a literal IP) must also be checked by what it actually
  // resolves to — the DNS-rebinding-adjacent bypass this guard previously missed entirely.
  if (net.isIP(host) === 0) {
    let addresses: { address: string; family: number }[];
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch (err) {
      throw new EgressError(`egress to ${host} could not be resolved: ${err instanceof Error ? err.message : String(err)}`);
    }
    const blocked = addresses.find((a) => isBlockedIp(a.address, a.family));
    if (blocked) {
      throw new EgressError(`egress to ${host} resolves to ${blocked.address}, which is blocked (link-local/metadata range)`);
    }
  }
  const allowlist = parseCsvEnv("EGRESS_ALLOWLIST");
  if (allowlist.length) {
    const set = new Set(allowlist.map((s) => s.toLowerCase()));
    if (!set.has(host)) {
      throw new EgressError(`egress to ${host} is not in EGRESS_ALLOWLIST`);
    }
  }
  // Per-country residency: when a JSON policy is active, the host must sit in an allowed region's
  // egress allowlist. Throws a fail-closed DataResidencyError (451); a no-op when no policy is set.
  assertEgressResidency(rawUrl);
  return u;
}

/** fetch() with the egress guard applied first. Throws EgressError before any
 *  network call when the target is disallowed. */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  await assertEgressAllowed(url);
  return fetch(url, init);
}
