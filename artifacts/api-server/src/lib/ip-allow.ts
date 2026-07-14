import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";
import { parseCsvEnv } from "./env";
import { firstForwardedValue } from "./trust-proxy";

/**
 * App-layer IP allowlisting — defence in depth even behind an ingress/LB. When
 * `IP_ALLOWLIST` is set (comma-separated IPv4/IPv6 addresses or CIDRs), any client whose IP
 * is not in the list is refused with 403. Empty/unset ⇒ no-op (allow all).
 *
 * The client IP is the socket peer by default; set `TRUST_PROXY=1` to instead trust the first
 * hop in `X-Forwarded-For` (only safe when a trusted proxy sets it). IPv4-mapped IPv6
 * (`::ffff:1.2.3.4`) is normalised to its IPv4 form before matching.
 */

// ── CIDR matching (IPv4 + IPv6) ──────────────────────────────────────────────────
function v4ToInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    const o = Number(p);
    if (!/^\d+$/.test(p) || o < 0 || o > 255) return null;
    n = (n << 8n) | BigInt(o);
  }
  return n;
}

function v6ToInt(ip: string): bigint | null {
  let s = ip;
  // Embedded IPv4 (e.g. ::ffff:1.2.3.4) → convert the tail to two hextets.
  const v4m = /:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4m) {
    const v4 = v4ToInt(v4m[1]!);
    if (v4 === null) return null;
    s = s.slice(0, v4m.index + 1) + ((v4 >> 16n) & 0xffffn).toString(16) + ":" + (v4 & 0xffffn).toString(16);
  }
  const dbl = s.split("::");
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0]!.split(":") : [];
  const tail = dbl.length === 2 ? (dbl[1] ? dbl[1]!.split(":") : []) : [];
  if (dbl.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const groups = [...head, ...Array(dbl.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** Parse any IP to a (version, integer) pair, normalising IPv4-mapped IPv6. */
function parseIp(ip: string): { v: 4 | 6; n: bigint } | null {
  const cleaned = ip.trim().replace(/^::ffff:/i, (m) => (/\d+\.\d+\.\d+\.\d+$/.test(ip) ? "" : m));
  if (cleaned.includes(".") && !cleaned.includes(":")) {
    const n = v4ToInt(cleaned);
    return n === null ? null : { v: 4, n };
  }
  const n = v6ToInt(ip.trim());
  return n === null ? null : { v: 6, n };
}

/** A pre-parsed allowlist entry: the network base masked to its prefix, ready to match a client IP
 *  without re-parsing the CIDR each request. `prefix === 0` means "match every address of this
 *  version". Invalid entries parse to null (they never match), exactly as ipInCidr returned false. */
interface ParsedCidr { v: 4 | 6; prefix: number; mask: bigint; maskedBase: bigint }

/** Parse one CIDR/bare-IP entry to its matcher, or null if malformed (mirrors ipInCidr exactly). */
function parseCidrEntry(cidr: string): ParsedCidr | null {
  const slash = cidr.indexOf("/");
  const net = slash >= 0 ? cidr.slice(0, slash) : cidr;
  const base = parseIp(net);
  if (!base) return null;
  const bits = base.v === 4 ? 32 : 128;
  let prefix = bits;
  if (slash >= 0) {
    // Require an explicit numeric prefix. `Number("")` is 0, so a trailing-slash typo like
    // "10.0.0.0/" would otherwise parse as /0 and fail OPEN (match every address) — reject it.
    const raw = cidr.slice(slash + 1);
    if (!/^\d+$/.test(raw)) return null;
    prefix = Number(raw);
  }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { v: base.v, prefix, mask, maskedBase: base.n & mask };
}

/** Does a parsed client IP fall within a pre-parsed entry? */
function matchParsed(target: { v: 4 | 6; n: bigint }, p: ParsedCidr): boolean {
  if (target.v !== p.v) return false;
  if (p.prefix === 0) return true;
  return (target.n & p.mask) === p.maskedBase;
}

/** Does `ip` fall within `cidr` (or equal a bare IP)? */
export function ipInCidr(ip: string, cidr: string): boolean {
  const p = parseCidrEntry(cidr);
  const target = parseIp(ip);
  return !!p && !!target && matchParsed(target, p);
}

// Memoize the parsed allowlist keyed on the RAW env value: the entries + their pre-parsed matchers
// are rebuilt only when IP_ALLOWLIST actually changes, not split-and-CIDR-parsed on every request
// (ipAllowGuard + ipAllowed previously each re-read + re-parsed the whole list per request).
let allowlistCache: { raw: string | undefined; entries: string[]; parsed: ParsedCidr[] } | null = null;
function parsedAllowlist(): { entries: string[]; parsed: ParsedCidr[] } {
  const raw = process.env["IP_ALLOWLIST"];
  if (allowlistCache && allowlistCache.raw === raw) return allowlistCache;
  const entries = parseCsvEnv("IP_ALLOWLIST");
  const parsed = entries.map(parseCidrEntry).filter((p): p is ParsedCidr => p !== null);
  allowlistCache = { raw, entries, parsed };
  return allowlistCache;
}

/** The configured allowlist entries (empty ⇒ allowlisting off). */
export function ipAllowlist(): string[] {
  return parsedAllowlist().entries;
}

/** Is this client IP allowed? True when the allowlist is empty (feature off). */
export function ipAllowed(ip: string): boolean {
  const { entries, parsed } = parsedAllowlist();
  if (entries.length === 0) return true;
  const target = parseIp(ip);
  return target !== null && parsed.some((p) => matchParsed(target, p));
}

/** Resolve the client IP — socket peer, or the first X-Forwarded-For hop when TRUST_PROXY. */
export function clientIp(req: Request): string {
  const trust = process.env["TRUST_PROXY"]?.trim();
  if (trust && trust !== "0" && trust.toLowerCase() !== "false") {
    const xff = firstForwardedValue(req, "x-forwarded-for");
    if (xff) return xff;
  }
  return (req.socket?.remoteAddress ?? "").replace(/^::ffff:/i, "");
}

/** Middleware: refuse a client whose IP isn't allowlisted (no-op when the list is empty). */
export function ipAllowGuard(req: Request, res: Response, next: NextFunction): void {
  if (parsedAllowlist().entries.length === 0) { next(); return; }
  const ip = clientIp(req);
  if (ipAllowed(ip)) { next(); return; }
  logger.warn({ ip, path: req.path }, "ip-allowlist: blocked client");
  res.status(403).json({ error: "Access from this network is not permitted." });
}
