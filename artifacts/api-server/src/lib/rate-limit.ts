import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { Request } from "express";
import { getSession } from "../routes/auth";

/**
 * Rate limiting to protect n8n / OpenRouter from spam and scripting loops.
 * Keyed by the authenticated user (session sub) when available, else client IP.
 */

function keyFor(req: Request): string {
  return getSession(req)?.sub ?? req.ip ?? "anon";
}

const tooMany = {
  error: "Too many requests",
  message: "Rate limit exceeded. Please retry later.",
};

// Generous ceiling for all /api/* traffic.
export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyFor,
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => res.status(429).json(tooMany),
});

// Strict ceiling for expensive analytics endpoints: 30 requests / 15 min.
export const analyticsLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: keyFor,
  validate: { keyGeneratorIpFallback: false },
  handler: (_req, res) => res.status(429).json(tooMany),
});
