import net from "node:net";

/**
 * Correct (not string-prefix) containment checks for the link-local / cloud-metadata ranges
 * that the egress guards (`lib/egress.ts`, `lib/url-safety.ts`) must always reject:
 *
 *   - IPv4 169.254.0.0/16 (link-local, incl. the AWS/GCP/Azure/DO IMDS endpoint
 *     169.254.169.254 and the AWS ECS task-metadata endpoint 169.254.170.2)
 *   - IPv6 fe80::/10 (link-local)
 *   - The exact AWS IMDSv2 IPv6 address fd00:ec2::254
 *   - IPv4-mapped IPv6 forms of the above (`::ffff:169.254.x.x`), since a bracketed
 *     IPv6-mapped literal reaches the SAME network interface as its IPv4 form
 *
 * `new URL(...).hostname` already canonicalises numeric IPv4 obfuscation (decimal, hex,
 * octal octets all fold to dotted-decimal) and IPv6 literals (to the shortest hextet
 * form) per the WHATWG URL spec, so byte/hextet-level comparison here — rather than a
 * regex against the RAW input string — is both correct and sufficient for any literal-IP
 * hostname. It does NOT resolve a non-IP hostname; callers that need to stop a DNS-based
 * bypass (an attacker-controlled name that resolves to a metadata IP) must additionally
 * resolve the name and check the resolved address(es) with `isBlockedIp`.
 */

/** IPv4 dotted-decimal (as produced by `URL.hostname`) → true if in 169.254.0.0/16. */
export function isLinkLocalIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  return octets[0] === 169 && octets[1] === 254;
}

/** Expand a canonical (possibly `::`-compressed) IPv6 literal into its 8 hextets. */
function expandIPv6(ip: string): number[] | null {
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, undefined];
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  if (tail === undefined && headParts.length !== 8) return null; // no `::` ⇒ must be fully written out
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const allParts = tail === undefined ? headParts : [...headParts, ...Array<string>(missing).fill("0"), ...tailParts];
  const hextets = allParts.map((p) => parseInt(p, 16));
  if (hextets.length !== 8 || hextets.some((h) => !Number.isInteger(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}

/** IPv6 literal (as produced by `URL.hostname`, brackets stripped) → true if link-local
 *  (fe80::/10), the exact AWS IMDSv2 address, or an IPv4-mapped 169.254.0.0/16 address. */
export function isLinkLocalIPv6(ip: string): boolean {
  const h = expandIPv6(ip.toLowerCase());
  if (!h) return false;
  // fe80::/10 — the top 10 bits of the first hextet must equal fe80's top 10 bits.
  if ((h[0]! & 0xffc0) === 0xfe80) return true;
  // The exact AWS IMDSv2 IPv6 address: fd00:ec2::254.
  if (h[0] === 0xfd00 && h[1] === 0x0ec2 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 0x0254) return true;
  // IPv4-mapped IPv6 (::ffff:0:0/96): first 5 hextets zero, 6th is 0xffff, last two encode the IPv4 address.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    const a = (h[6]! >> 8) & 0xff;
    const b = h[6]! & 0xff;
    return a === 169 && b === 254;
  }
  return false;
}

/** Known cloud-metadata hostnames that are never a legitimate egress target — reachable
 *  by name (not just IP) via internal cloud DNS in some environments. */
export const BLOCKED_METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata"]);

/** Is `host` (already lower-cased, IPv6 brackets stripped) a blocked literal — a known
 *  metadata hostname, or an IPv4/IPv6 literal in the link-local/metadata range? Does
 *  NOT resolve a plain hostname — see the module docstring. */
export function isBlockedHostLiteral(host: string): boolean {
  if (BLOCKED_METADATA_HOSTNAMES.has(host)) return true;
  const family = net.isIP(host);
  if (family === 4) return isLinkLocalIPv4(host);
  if (family === 6) return isLinkLocalIPv6(host);
  return false;
}

/** Is a resolved DNS address (from `dns.lookup`) in the blocked link-local/metadata range? */
export function isBlockedIp(address: string, family: number): boolean {
  if (family === 4) return isLinkLocalIPv4(address);
  if (family === 6) return isLinkLocalIPv6(address);
  return false;
}

// ── Private / loopback ranges (OPT-IN hardened egress only) ─────────────────────────────────────────
// The link-local/metadata checks above are the ALWAYS-ON floor. These broader private/loopback ranges
// are blocked only when an operator opts into the hardened egress posture (EGRESS_BLOCK_PRIVATE), because
// many normal deployments legitimately call internal hosts (a self-hosted broker like http://n8n:5678, a
// LAN logging server). They stop the gateway being used as an SSRF relay to internal-only services.

/** IPv4 dotted-decimal → true if RFC1918 private, loopback (127/8), CGNAT (100.64/10), or this-host (0/8). */
export function isPrivateOrLoopbackIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const o = parts.map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const a = o[0]!, b = o[1]!;
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 127) return true;                        // 127.0.0.0/8 loopback
  if (a === 0) return true;                          // 0.0.0.0/8 this-host
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** IPv6 literal → true if loopback (::1), unique-local (fc00::/7), or an IPv4-mapped private/loopback v4. */
export function isPrivateOrLoopbackIPv6(ip: string): boolean {
  const h = expandIPv6(ip.toLowerCase());
  if (!h) return false;
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0 && h[6] === 0 && h[7] === 1) return true; // ::1
  if ((h[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) { // IPv4-mapped
    const a = (h[6]! >> 8) & 0xff, b = h[6]! & 0xff, c = (h[7]! >> 8) & 0xff, d = h[7]! & 0xff;
    return isPrivateOrLoopbackIPv4(`${a}.${b}.${c}.${d}`);
  }
  return false;
}

/** Is a resolved DNS address in a private/loopback range (opt-in hardened egress)? */
export function isPrivateOrLoopbackIp(address: string, family: number): boolean {
  if (family === 4) return isPrivateOrLoopbackIPv4(address);
  if (family === 6) return isPrivateOrLoopbackIPv6(address);
  return false;
}

/** Is `host` (lower-cased, brackets stripped) a private/loopback IP literal? A plain hostname is not a
 *  literal — its resolved addresses are checked separately with `isPrivateOrLoopbackIp`. */
export function isPrivateOrLoopbackHostLiteral(host: string): boolean {
  const family = net.isIP(host);
  if (family === 4) return isPrivateOrLoopbackIPv4(host);
  if (family === 6) return isPrivateOrLoopbackIPv6(host);
  return false;
}
