/**
 * The attachments-broker HTTP service. A tiny node:http server (no framework, no dependencies) exposing
 * a blob store over a small contract the gateway's attachments client will speak:
 *   PUT    /blob/<key>   store bytes         → { ok, key, size, sha256 }
 *   GET    /blob/<key>   fetch bytes         → application/octet-stream (404 if absent)
 *   HEAD   /blob/<key>   existence probe     → 200 / 404
 *   DELETE /blob/<key>   remove bytes        → { ok } / 404
 *   GET    /healthz      liveness (open)     → { ok: true }
 *
 * Bearer-token auth via ATTACHMENTS_BROKER_TOKEN gates every /blob/* op (never /healthz). It holds the
 * bytes itself (below the seam) so the gateway stays zero-at-rest and SDK-free.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createFsStore, isValidKey } from "./store.mjs";

/** Default max body size for an uploaded blob (override with ATTACHMENTS_MAX_BYTES). An unbounded buffer
 *  on an open PUT is a trivial memory-exhaustion DoS. */
const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

export class BodyTooLargeError extends Error {}

/** Buffer the request body, rejecting past `limit` bytes (both the declared content-length and the
 *  actual stream length). */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      return reject(new BodyTooLargeError("request body too large"));
    }
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyTooLargeError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Constant-time bearer check — avoids leaking the token via response-time correlation. */
function bearerOk(header, token) {
  const prefix = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Build the request handler over a store + optional token — exported for tests. */
export function createHandler(store, token, opts = {}) {
  const limit = opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  return async (req, res) => {
    const url = req.url ?? "";
    const method = req.method ?? "GET";
    if (method === "GET" && url === "/healthz") return send(res, 200, { ok: true });
    if (token && !bearerOk(req.headers["authorization"], token)) return send(res, 401, { error: "unauthorized" });

    const m = url.match(/^\/blob\/([^/?#]+)$/);
    if (!m) return send(res, 404, { error: "not found" });
    const key = decodeURIComponent(m[1]);
    if (!isValidKey(key)) return send(res, 400, { error: "invalid key" });

    try {
      if (method === "PUT") {
        const buf = await readBody(req, limit);
        return send(res, 200, { ok: true, ...(await store.put(key, buf)) });
      }
      if (method === "GET") {
        const buf = await store.get(key);
        if (!buf) return send(res, 404, { error: "not found" });
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(buf.length) });
        return res.end(buf);
      }
      if (method === "HEAD") {
        const has = await store.has(key);
        res.writeHead(has ? 200 : 404);
        return res.end();
      }
      if (method === "DELETE") {
        const existed = await store.del(key);
        return send(res, existed ? 200 : 404, existed ? { ok: true } : { error: "not found" });
      }
      return send(res, 405, { error: "method not allowed" });
    } catch (err) {
      if (err instanceof BodyTooLargeError) return send(res, 413, { error: err.message });
      // Never echo a raw fs error (leaks paths); keep it server-side.
      // eslint-disable-next-line no-console
      console.error("attachments-broker: op failed", { method, key, err: String(err) });
      return send(res, 500, { error: "internal error" });
    }
  };
}

/** Boot the server from the environment. Only runs when executed directly, not when imported. */
export function main() {
  const port = Number(process.env["PORT"] ?? 8091);
  const host = process.env["HOST"]?.trim() || "0.0.0.0";
  const dir = process.env["ATTACHMENTS_BROKER_DIR"]?.trim() || "/data";
  const token = process.env["ATTACHMENTS_BROKER_TOKEN"]?.trim();
  const allowAnon = process.env["ATTACHMENTS_BROKER_ALLOW_ANON"] === "1";
  // Fail closed: /blob/* reads and writes user file bytes, so refuse to serve unauthenticated unless the
  // operator explicitly opts in (e.g. a loopback-only dev run).
  if (!token && !allowAnon) {
    // eslint-disable-next-line no-console
    console.error(
      "attachments-broker: refusing to start without ATTACHMENTS_BROKER_TOKEN. " +
        "Set the token, or set ATTACHMENTS_BROKER_ALLOW_ANON=1 to accept UNAUTHENTICATED requests (not for production).",
    );
    process.exit(1);
  }
  if (!token && allowAnon) {
    // eslint-disable-next-line no-console
    console.warn(`attachments-broker: WARNING — running UNAUTHENTICATED (ATTACHMENTS_BROKER_ALLOW_ANON=1) on ${host}:${port}`);
  }
  const store = createFsStore(dir);
  const handler = createHandler(store, token || undefined);
  createServer((req, res) => void handler(req, res)).listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`attachments-broker listening on ${host}:${port} (dir=${dir})`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
