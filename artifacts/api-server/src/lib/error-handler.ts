import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";
import { recordUnhandledError } from "./runtime-metrics";

/**
 * Central error-capture seam — the one place an unhandled route error lands.
 *
 * Why it matters for a pilot: without this, a thrown error in a handler produces
 * Express's default HTML stack-trace response (leaks internals) and you only find
 * out something broke when a user complains. This handler instead:
 *   1. fingerprints the error (stable hash of name + message + top stack frame) so
 *      recurring failures group in logs / can wire to Sentry-style alerting later;
 *   2. structured-logs it with request context (method, path, requestId);
 *   3. counts it in the RED metrics (omniproject_unhandled_errors_total);
 *   4. returns a SAFE generic 500 JSON — never a stack trace to the client.
 *
 * It is deliberately last in the middleware chain. Broker errors are already
 * mapped to safe codes by respondBrokerError upstream; anything reaching here is
 * an unexpected bug, which is precisely what we want to see.
 */

/** A short, stable id for an error so repeats group together. */
export function fingerprint(err: unknown): string {
  const e = err as { name?: string; message?: string; stack?: string };
  const topFrame = (e?.stack?.split("\n")[1] ?? "").trim();
  const basis = `${e?.name ?? "Error"}:${e?.message ?? ""}:${topFrame}`;
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 12);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs the 4-arg arity to treat this as an error handler.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const e = err as { name?: string; message?: string; stack?: string; status?: number; statusCode?: number; expose?: boolean };

  // Honour an error's own HTTP status when present — middleware like body-parser
  // throws safe http-errors (413 too-large, 400 malformed JSON) with `expose:true`
  // and a client-safe message. Anything WITHOUT a status is an unexpected bug → 500.
  const rawStatus = Number(e?.status ?? e?.statusCode);
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const isBug = status >= 500;
  const fp = fingerprint(err);

  const log = (req as { log?: typeof logger }).log ?? logger;
  const detail = {
    err: { name: e?.name, message: e?.message, fingerprint: fp, status },
    reqId: (req as { id?: unknown }).id,
    method: req.method,
    path: req.path,
  };
  if (isBug) {
    recordUnhandledError(); // the RED error metric tracks real bugs (5xx), not client 4xx
    log.error(detail, "unhandled_error");
  } else {
    log.warn(detail, "client_error");
  }

  // If a response was already partly sent, we cannot send a body — just end so the
  // socket isn't held open.
  if (res.headersSent) {
    res.end();
    return;
  }
  // For an exposed http-error (4xx) the library message is safe to surface; for a
  // 5xx bug, never leak internals — a generic message + a reference id to correlate
  // with the server log.
  const message = e?.expose === true && typeof e.message === "string" && status < 500
    ? e.message
    : status < 500 ? "Bad request" : "Internal server error";
  res.status(status).json({ error: message, reference: fp });
}
