import zlib from "node:zlib";
import type { Request, Response, NextFunction } from "express";

/**
 * Dependency-free response compression (gzip/brotli) for the gateway.
 *
 * Why hand-rolled: the runtime can't pull the `compression` npm package, and we want
 * full control of the policy anyway. It buffers a response, then compresses on `end`,
 * so it works for both JSON routes and the statically-served SPA. Streaming, ranged,
 * binary and already-encoded responses pass straight through untouched — crucially
 * Server-Sent Events (which set `no-transform` and use `writeHead`, so their
 * Content-Type is never visible here) are never buffered and keep streaming live.
 */

// Text-ish types worth compressing; fonts/images are already compressed.
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;
// Below this, the header/CPU overhead outweighs the saving.
const MIN_BYTES = 1024;
// Brotli at max quality (11) is far too slow for dynamic responses; 5 is the sweet spot.
const BROTLI_OPTS = { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } };

/** Best encoding the client accepts — brotli preferred, then gzip, else none. */
export function negotiateEncoding(acceptEncoding: string | undefined): "br" | "gzip" | null {
  const a = acceptEncoding ?? "";
  if (/\bbr\b/.test(a)) return "br";
  if (/\bgzip\b/.test(a)) return "gzip";
  return null;
}

/** Is a response with these headers safe — and worth — compressing? */
export function isCompressible(contentType: unknown, cacheControl: unknown, contentEncoding: unknown): boolean {
  if (contentEncoding) return false; // already encoded — never double-encode
  if (/no-transform/i.test(String(cacheControl ?? ""))) return false; // SSE + opt-outs
  const ct = String(contentType ?? "");
  if (ct.includes("text/event-stream")) return false; // belt-and-braces for SSE
  return COMPRESSIBLE.test(ct);
}

function toBuffer(chunk: unknown, enc?: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  return Buffer.from(String(chunk), (typeof enc === "string" ? enc : "utf8") as BufferEncoding);
}

/** Express middleware: negotiate + buffer-then-compress, with safe pass-throughs. */
export function compression() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const encoding = negotiateEncoding(req.headers["accept-encoding"] as string | undefined);
    // No acceptable encoding, or a ranged request (compressing a 206 slice is wrong).
    if (!encoding || req.headers.range) { next(); return; }

    const chunks: Buffer[] = [];
    let decided = false;
    let intercept = true;
    const realWrite = res.write.bind(res) as (...a: unknown[]) => boolean;
    const realEnd = res.end.bind(res) as (...a: unknown[]) => Response;

    // Decide once, lazily, when the first byte is written and headers are known.
    const decide = (): void => {
      if (decided) return;
      decided = true;
      intercept =
        res.statusCode === 200 &&
        isCompressible(res.getHeader("Content-Type"), res.getHeader("Cache-Control"), res.getHeader("Content-Encoding"));
    };

    res.write = function (chunk: unknown, ...args: unknown[]): boolean {
      decide();
      if (!intercept) return realWrite(chunk, ...args);
      if (chunk) chunks.push(toBuffer(chunk, args[0]));
      return true;
    } as typeof res.write;

    res.end = function (chunk?: unknown, ...args: unknown[]): Response {
      decide();
      if (!intercept) return realEnd(chunk, ...args);
      if (chunk) chunks.push(toBuffer(chunk));
      const body = Buffer.concat(chunks);
      if (body.length < MIN_BYTES) {
        if (body.length) realWrite(body);
        return realEnd();
      }
      const finish = (err: Error | null, out: Buffer): Response => {
        if (err) { realWrite(body); return realEnd(); }
        res.setHeader("Content-Encoding", encoding);
        res.setHeader("Vary", "Accept-Encoding");
        res.removeHeader("Content-Length");
        // A compressed body is a different entity — weaken a strong ETag so caches
        // don't serve the compressed bytes for an identity request and vice-versa.
        const etag = res.getHeader("ETag");
        if (typeof etag === "string" && !etag.startsWith("W/")) res.setHeader("ETag", `W/${etag}`);
        realWrite(out);
        return realEnd();
      };
      if (encoding === "br") zlib.brotliCompress(body, BROTLI_OPTS, finish);
      else zlib.gzip(body, finish);
      return res;
    } as typeof res.end;

    next();
  };
}
