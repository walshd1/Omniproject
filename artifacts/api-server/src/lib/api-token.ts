import type { Request } from "express";
import { constantTimeEqual } from "./crypto-keys";

/**
 * Read-only API tokens for non-interactive clients (e.g. Power BI's Web
 * connector, scheduled exports). Configure one or more comma-separated tokens
 * in API_TOKENS. A request presenting a valid token via `Authorization: Bearer`
 * or `X-API-Key` is treated as an authenticated *read-only* principal — it can
 * GET data and exports but cannot mutate (see requireAuth).
 *
 * Generate a token with: `openssl rand -hex 32`.
 */

const TOKENS = (process.env["API_TOKENS"] ?? "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

export const apiTokensConfigured = TOKENS.length > 0;

function presentedToken(req: Request): string | null {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();

  const auth = req.headers["authorization"];
  const header = Array.isArray(auth) ? auth[0] : auth;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();

  return null;
}

/** True when the request carries a valid read-only API token. */
export function hasValidApiToken(req: Request): boolean {
  if (!apiTokensConfigured) return false;
  const token = presentedToken(req);
  if (!token) return false;
  return TOKENS.some((valid) => constantTimeEqual(valid, token));
}
