import rateLimit from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getSession } from "../routes/auth";

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
 */

function keyFor(req: Request): string {
  return getSession(req)?.sub ?? req.ip ?? "anon";
}

const tooMany = {
  error: "Too many requests",
  message: "Rate limit exceeded. Please retry later.",
};

const DISABLED = process.env["RATE_LIMIT_DISABLED"]?.trim().toLowerCase() === "true";
const passThrough: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => next();

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function makeLimiter(limit: number): RequestHandler {
  if (DISABLED) return passThrough;
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: keyFor,
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => res.status(429).json(tooMany),
  });
}

// Generous ceiling for all /api/* traffic.
export const apiLimiter: RequestHandler = makeLimiter(envLimit("API_RATE_LIMIT_MAX", 300));

// Strict ceiling for expensive analytics endpoints.
export const analyticsLimiter: RequestHandler = makeLimiter(envLimit("ANALYTICS_RATE_LIMIT_MAX", 30));
