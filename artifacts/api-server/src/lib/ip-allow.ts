import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

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

/** Does `ip` fall within `cidr` (or equal a bare IP)? */
export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  const net = slash >= 0 ? cidr.slice(0, slash) : cidr;
  const target = parseIp(ip);
  const base = parseIp(net);
  if (!target || !base || target.v !== base.v) return false;
  const bits = target.v === 4 ? 32 : 128;
  const prefix = slash >= 0 ? Number(cidr.slice(slash + 1)) : bits;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return false;
  if (prefix === 0) return true;
  const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return (target.n & mask) === (base.n & mask);
}

/** The configured allowlist entries (empty ⇒ allowlisting off). */
export function ipAllowlist(): string[] {
  return (process.env["IP_ALLOWLIST"]?.trim() || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Is this client IP allowed? True when the allowlist is empty (feature off). */
export function ipAllowed(ip: string): boolean {
  const list = ipAllowlist();
  if (list.length === 0) return true;
  return list.some((cidr) => ipInCidr(ip, cidr));
}

/** Resolve the client IP — socket peer, or the first X-Forwarded-For hop when TRUST_PROXY. */
export function clientIp(req: Request): string {
  const trust = process.env["TRUST_PROXY"]?.trim();
  if (trust && trust !== "0" && trust.toLowerCase() !== "false") {
    const xff = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
    if (xff) return xff;
  }
  return (req.socket?.remoteAddress ?? "").replace(/^::ffff:/i, "");
}

/** Middleware: refuse a client whose IP isn't allowlisted (no-op when the list is empty). */
export function ipAllowGuard(req: Request, res: Response, next: NextFunction): void {
  if (ipAllowlist().length === 0) { next(); return; }
  const ip = clientIp(req);
  if (ipAllowed(ip)) { next(); return; }
  logger.warn({ ip, path: req.path }, "ip-allowlist: blocked client");
  res.status(403).json({ error: "Access from this network is not permitted." });
}
