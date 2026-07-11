import rateLimit, { type Store } from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getSession } from "../routes/auth";
import { logger } from "./logger";
import { envInt, isTruthy } from "./env-config";

/**
 * Rate limiting to protect n8n / OpenRouter from spam and scripting loops.
 * Keyed by the authenticated user (session sub) when available, else client IP.
 *
 * Tunable via env so a high-concurrency deployment (or a load test) isn't
 * throttled by the defaults:
 *   API_RATE_LIMIT_MAX        (default 300)  — per 15 min, all /api/*
 *   ANALYTICS_RATE_LIMIT_MAX  (default 30)   — per 15 min, analytics endpoints
 *   RATE_LIMIT_DISABLED=true                 — bypass entirely (e.g. behind an
 *                                              external gateway/WAF, or stress test)
 *
 * Multi-replica: the default counter store is in-memory and therefore PER-REPLICA
 * — with N replicas the effective global ceiling is N×. When `REDIS_URL` is set
 * (and the optional `rate-limit-redis` + `ioredis` deps are installed), the
 * counters move to a SHARED Redis store so the ceiling is enforced fleet-wide.
 * The store is swapped in asynchronously after boot behind a stable delegating
 * middleware, so routes import a fixed handler and we carry zero required deps
 * (falls back to per-replica, logged once, if Redis/deps are absent).
 */

function keyFor(req: Request): string {
  return getSession(req)?.sub ?? req.ip ?? "anon";
}

/** Login is pre-session, so the strict login limiter keys strictly by client IP. */
function ipKey(req: Request): string {
  return req.ip ?? "anon";
}

const tooMany = {
  error: "Too many requests",
  message: "Rate limit exceeded. Please retry later.",
};

const WINDOW_MS = 15 * 60 * 1000;
const DISABLED = isTruthy(process.env["RATE_LIMIT_DISABLED"]);
const passThrough: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => next();

function buildLimiter(limit: number, store?: Store, keyGenerator: (req: Request) => string = keyFor): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => res.status(429).json(tooMany),
    ...(store ? { store } : {}),
  });
}

/** A stable middleware whose underlying limiter can be swapped at runtime (memory
 *  → shared Redis store) without routes re-importing. */
function delegating(initial: RequestHandler): { mw: RequestHandler; set: (h: RequestHandler) => void } {
  let active = initial;
  const mw: RequestHandler = (req, res, next) => active(req, res, next);
  return { mw, set: (h) => { active = h; } };
}

const API_MAX = envInt("API_RATE_LIMIT_MAX", 300, { min: 1 });
const ANALYTICS_MAX = envInt("ANALYTICS_RATE_LIMIT_MAX", 30, { min: 1 });
// Strict, IP-keyed ceiling for the SSO/login initiation endpoints (brute-force /
// flow-cookie-spam guard). Tunable via AUTH_RATE_LIMIT_MAX — raise it for a large
// deployment behind a shared NAT/corporate egress IP (or rely on the IdP's own
// throttling), since many users can then share one source address.
const AUTH_MAX = envInt("AUTH_RATE_LIMIT_MAX", 30, { min: 1 });

const apiDel = delegating(DISABLED ? passThrough : buildLimiter(API_MAX));
const analyticsDel = delegating(DISABLED ? passThrough : buildLimiter(ANALYTICS_MAX));
const authDel = delegating(DISABLED ? passThrough : buildLimiter(AUTH_MAX, undefined, ipKey));

// Generous ceiling for all /api/* traffic.
export const apiLimiter: RequestHandler = apiDel.mw;
// Strict ceiling for expensive analytics endpoints.
export const analyticsLimiter: RequestHandler = analyticsDel.mw;
// Strict, per-IP ceiling for login / step-up initiation.
export const loginLimiter: RequestHandler = authDel.mw;

let mode: "in-process" | "redis" = "in-process";
/** Whether rate-limit counters are per-replica ("in-process") or shared ("redis"). */
export function rateLimitMode(): "in-process" | "redis" {
  return mode;
}

interface RedisDeps {
  RedisStore: new (o: unknown) => Store;
  client: { call: (...a: string[]) => Promise<unknown> };
}

/** Resolve the runtime-optional Redis deps (rate-limit-redis + ioredis) and construct the
 *  client. Null (logged once) when either isn't installed. Doesn't touch the limiters. */
async function loadRedisDeps(url: string): Promise<RedisDeps | null> {
  // Runtime-optional deps (dynamic import via a variable so they aren't a
  // committed dependency / statically resolved) so single-replica deploys carry none.
  const rlrName = "rate-limit-redis";
  const ioName = "ioredis";
  const [rlr, io] = await Promise.all([
    import(rlrName).catch(() => null),
    import(ioName).catch(() => null),
  ]);
  const RedisStore = (rlr as { default?: unknown; RedisStore?: unknown } | null)?.default
    ?? (rlr as { RedisStore?: unknown } | null)?.RedisStore;
  const Redis = (io as { default?: new (u: string) => unknown } | null)?.default;
  if (typeof RedisStore !== "function" || typeof Redis !== "function") {
    logger.warn("rate limit: REDIS_URL set but 'rate-limit-redis'/'ioredis' not installed — limits are PER-REPLICA. Run: pnpm --filter @workspace/api-server add rate-limit-redis ioredis");
    return null;
  }
  const client = new (Redis as new (u: string) => { call: (...a: string[]) => Promise<unknown> })(url);
  return { RedisStore: RedisStore as new (o: unknown) => Store, client };
}

/** Wire the three limiters onto a shared Redis store, given already-resolved deps. */
function wireRedisLimiters(deps: RedisDeps): void {
  const mkStore = (prefix: string): Store =>
    new deps.RedisStore({ prefix, sendCommand: (...args: string[]) => deps.client.call(...args) });
  apiDel.set(buildLimiter(API_MAX, mkStore("rl:api:")));
  analyticsDel.set(buildLimiter(ANALYTICS_MAX, mkStore("rl:analytics:")));
  authDel.set(buildLimiter(AUTH_MAX, mkStore("rl:auth:"), ipKey));
  mode = "redis";
  logger.info("rate limit: shared Redis store enabled (global ceiling across replicas)");
}

async function initRedisStore(url: string): Promise<void> {
  try {
    const deps = await loadRedisDeps(url);
    if (!deps) return;
    wireRedisLimiters(deps);
  } catch (err) {
    logger.warn({ err }, "rate limit: Redis store init failed — limits remain per-replica");
  }
}

if (!DISABLED && process.env["REDIS_URL"]?.trim()) {
  void initRedisStore(process.env["REDIS_URL"].trim());
}
