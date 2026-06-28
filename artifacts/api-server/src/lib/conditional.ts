import crypto from "node:crypto";
import type { Request, Response } from "express";

/**
 * Conditional (delta) reads — let a client revalidate a read and get back "nothing
 * changed" instead of the whole payload, WITHOUT the gateway storing any data. The
 * data lives only in the client's cache; the gateway relays a version check:
 *
 *  - When the broker can supply a cheap CHANGE TOKEN for a resource (a backend ETag,
 *    a max(updatedAt), …), the gateway compares it to the client's `If-None-Match`.
 *    A match ⇒ `304 Not Modified` and the heavy backend read is SKIPPED entirely.
 *  - Otherwise it falls back to a hash of the freshly-read payload: the backend is
 *    still read, but an unchanged result returns `304` so the bytes aren't re-sent.
 *
 * Either way the backend stays the single source of truth and nothing is cached on
 * the server — only the client keeps the copy it already had.
 */

/** A weak ETag derived from a payload (used when no change token is available). */
export function hashETag(data: unknown): string {
  return `W/"h-${crypto.createHash("sha1").update(JSON.stringify(data) ?? "").digest("base64url")}"`;
}

/** A weak ETag derived from a broker-supplied change token. */
export function tokenETag(token: string): string {
  return `W/"t-${crypto.createHash("sha1").update(token).digest("base64url")}"`;
}

/** The caller's If-None-Match value, if any. */
export function ifNoneMatch(req: Request): string | null {
  const v = req.headers["if-none-match"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function setValidators(res: Response, etag: string): void {
  res.setHeader("ETag", etag);
  // Force revalidation (so the client always asks) but allow a 304 to reuse its copy.
  res.setHeader("Cache-Control", "private, no-cache");
}

/**
 * Send a read response with delta semantics. If `token` is supplied (broker change
 * token) it is used for the comparison and a match avoids the read entirely; else
 * the freshly-read payload is hashed. `read` is only invoked when needed.
 */
export async function conditionalJson(
  req: Request,
  res: Response,
  opts: { token?: string | null; read: () => Promise<unknown> },
): Promise<void> {
  const inm = ifNoneMatch(req);
  if (opts.token) {
    const etag = tokenETag(opts.token);
    if (inm === etag) {
      setValidators(res, etag);
      res.status(304).end(); // unchanged — backend heavy-read skipped
      return;
    }
    setValidators(res, etag);
    res.json(await opts.read());
    return;
  }
  const data = await opts.read();
  const etag = hashETag(data);
  if (inm === etag) {
    setValidators(res, etag);
    res.status(304).end(); // unchanged — payload not re-sent
    return;
  }
  setValidators(res, etag);
  res.json(data);
}
