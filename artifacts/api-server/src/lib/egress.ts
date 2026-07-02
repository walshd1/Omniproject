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
 *     IPv6 fe80::/10 and fd00:ec2::254, metadata.google.internal). Nothing
 *     legitimate ever fetches these *through the app*, so blocking them is free.
 *   - **Always blocked:** non-http(s) schemes (file:, gopher:, etc.).
 *   - **Optional strict mode:** set `EGRESS_ALLOWLIST` to a comma-separated host
 *     list and ALL outbound hosts must match — for deployments that want to pin
 *     egress to exactly their broker/IdP/FX hosts.
 *   - **Per-country residency:** when a `DATA_RESIDENCY_POLICY` is configured, the
 *     host must also sit in an allowed region's egress allowlist, else the hop is
 *     refused with a `DataResidencyError` (451). Inert when no policy is set.
 *
 * Use `safeFetch` everywhere the gateway makes an outbound request.
 */
import { assertEgressResidency } from "./data-residency";

export class EgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressError";
  }
}

const BLOCKED_HOSTS = new Set(["metadata.google.internal"]);

/** Link-local v4 (169.254/16 — incl. the AWS/GCP/Azure metadata IP) and the
 *  IPv6 link-local / EC2 metadata forms. */
function isLinkLocalOrMetadata(host: string): boolean {
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  const h = host.toLowerCase();
  if (h.startsWith("fe80:") || h.startsWith("fe80::")) return true; // IPv6 link-local
  if (h === "fd00:ec2::254") return true; // IPv6 EC2 metadata
  return false;
}

/** Validate a URL is allowed for server-side egress; throws EgressError if not.
 *  Returns the parsed URL on success. */
export function assertEgressAllowed(rawUrl: string): URL {
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
  if (BLOCKED_HOSTS.has(host) || isLinkLocalOrMetadata(host)) {
    throw new EgressError(`egress to ${host} is blocked (link-local/metadata range)`);
  }
  const allow = process.env["EGRESS_ALLOWLIST"]?.trim();
  if (allow) {
    const set = new Set(allow.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
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
export function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  assertEgressAllowed(url);
  return fetch(url, init);
}
