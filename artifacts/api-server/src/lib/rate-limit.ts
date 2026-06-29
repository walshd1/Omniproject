import rateLimit, { type Store } from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getSession } from "../routes/auth";
import { logger } from "./logger";

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
const DISABLED = process.env["RATE_LIMIT_DISABLED"]?.trim().toLowerCase() === "true";
const passThrough: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => next();

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

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

const API_MAX = envLimit("API_RATE_LIMIT_MAX", 300);
const ANALYTICS_MAX = envLimit("ANALYTICS_RATE_LIMIT_MAX", 30);
// Strict, IP-keyed ceiling for the SSO/login initiation endpoints (brute-force /
// flow-cookie-spam guard). Tunable via AUTH_RATE_LIMIT_MAX — raise it for a large
// deployment behind a shared NAT/corporate egress IP (or rely on the IdP's own
// throttling), since many users can then share one source address.
const AUTH_MAX = envLimit("AUTH_RATE_LIMIT_MAX", 30);

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

async function initRedisStore(url: string): Promise<void> {
  try {
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
      return;
    }
    const client = new (Redis as new (u: string) => { call: (...a: string[]) => Promise<unknown> })(url);
    const Ctor = RedisStore as new (o: unknown) => Store;
    const mkStore = (prefix: string): Store =>
      new Ctor({ prefix, sendCommand: (...args: string[]) => client.call(...args) });
    apiDel.set(buildLimiter(API_MAX, mkStore("rl:api:")));
    analyticsDel.set(buildLimiter(ANALYTICS_MAX, mkStore("rl:analytics:")));
    authDel.set(buildLimiter(AUTH_MAX, mkStore("rl:auth:"), ipKey));
    mode = "redis";
    logger.info("rate limit: shared Redis store enabled (global ceiling across replicas)");
  } catch (err) {
    logger.warn({ err }, "rate limit: Redis store init failed — limits remain per-replica");
  }
}

if (!DISABLED && process.env["REDIS_URL"]?.trim()) {
  void initRedisStore(process.env["REDIS_URL"].trim());
}
