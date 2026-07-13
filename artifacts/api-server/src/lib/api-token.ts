import type { Request } from "express";
import { constantTimeEqual } from "./crypto-keys";

/**
 * Read-only API tokens for non-interactive clients (e.g. Power BI's Web connector, scheduled exports,
 * and the cross-instance federation fetch). Configure one or more comma-separated tokens in API_TOKENS.
 * A request presenting a valid token via `Authorization: Bearer` or `X-API-Key` is an authenticated
 * *read-only* principal — it can GET data + exports but cannot mutate (see requireAuth).
 *
 * SCOPED TOKENS (lateral-movement containment): a token may be bound to one or more programmes so a
 * leaked/over-broad token — or a token handed to a federation peer — can only read THAT slice, not the
 * whole portfolio. Format per comma-separated entry:
 *
 *     <token>                     unscoped — broad read (back-compat; user-level, unchanged)
 *     <token>@<programmeId>       scoped to one programme
 *     <token>@<progA>|<progB>     scoped to several programmes
 *
 * A hex token (`openssl rand -hex 32`) never contains `@` or `|`, so the split is unambiguous. A scoped
 * token resolves to programme-level scope (scopeForReq), so every per-resource guard already enforces it.
 */

export interface ApiTokenScope {
  /** The programmes this token may read, or null for an unscoped (broad) token. */
  programmes: string[] | null;
}

interface ParsedToken {
  token: string;
  programmes: string[] | null;
}

function parseTokens(raw: string): ParsedToken[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf("@");
      if (at === -1) return { token: entry, programmes: null };
      const token = entry.slice(0, at).trim();
      const programmes = entry
        .slice(at + 1)
        .split("|")
        .map((p) => p.trim())
        .filter(Boolean);
      return { token, programmes: programmes.length ? programmes : null };
    })
    .filter((t) => t.token.length > 0);
}

// Parsed lazily on first use (not at module load) so a test can set API_TOKENS before the first request
// despite ESM import hoisting; the value is otherwise stable for the process lifetime.
let parsed: ParsedToken[] | null = null;
function tokens(): ParsedToken[] {
  if (parsed === null) parsed = parseTokens(process.env["API_TOKENS"] ?? "");
  return parsed;
}

/** Test-only: forget the parsed token cache so a changed API_TOKENS is re-read. */
export function __resetApiTokensForTest(): void {
  parsed = null;
}

function presentedToken(req: Request): string | null {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();

  const auth = req.headers["authorization"];
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();

  return null;
}

/**
 * Match the request's presented token and return its scope, or null when there is no valid token.
 * Constant-time compares every configured token (no early-out on a prefix) so a mismatch leaks no timing.
 */
export function matchApiToken(req: Request): ApiTokenScope | null {
  const configured = tokens();
  if (configured.length === 0) return null;
  const presented = presentedToken(req);
  if (!presented) return null;
  let matched: ParsedToken | null = null;
  for (const t of configured) {
    // Compare ALL of them (don't break) so the number of comparisons doesn't depend on which matched.
    if (constantTimeEqual(t.token, presented)) matched = t;
  }
  return matched ? { programmes: matched.programmes } : null;
}

/** True when the request carries a valid read-only API token (any scope). */
export function hasValidApiToken(req: Request): boolean {
  return matchApiToken(req) !== null;
}
