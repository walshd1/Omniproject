/**
 * The attachments-broker HTTP service. A tiny node:http server (no framework, no dependencies) that is the
 * ONE place a file's bytes ever live — so a (possibly malicious) upload is confined to this hardened,
 * isolated container and never reaches the gateway/main app.
 *
 * Two auth planes:
 *  - BROWSER plane (`/portal/<key>`): the browser uploads/downloads bytes DIRECTLY here, authorised by a
 *    short-lived, gateway-minted TICKET (HMAC, scoped to one op + key, quickly-expiring). CORS-enabled so
 *    the SPA can reach it cross-origin. The bytes never transit the gateway.
 *      PUT  /portal/<key>?ticket=…   store bytes           → { ok, key, size, sha256 }
 *      GET  /portal/<key>?ticket=…   fetch bytes           → application/octet-stream
 *  - SERVER plane (`/blob/<key>`): bearer-token, server-to-server, for the gateway's metadata-only ops
 *    (HEAD to verify an upload's size, DELETE to drop bytes on removal). No bytes flow to the gateway.
 *      HEAD   /blob/<key>            existence + size       → 200 (X-Attachment-Size) / 404
 *      DELETE /blob/<key>            remove bytes           → { ok } / 404
 *  - GET /healthz (open) — liveness.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createFsStore, isValidKey } from "./store.mjs";
import { verifyTicket } from "./ticket.mjs";
import { scanBlob } from "./scan.mjs";

const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

export class BodyTooLargeError extends Error {}

/** Buffer the request body, rejecting past `limit` bytes (declared content-length AND actual stream). */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) return reject(new BodyTooLargeError("request body too large"));
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new BodyTooLargeError("request body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Constant-time bearer check for the server-to-server plane. */
function bearerOk(header, token) {
  const prefix = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

function send(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}

/** CORS headers for the browser plane. `origin` is the configured app origin (or "*"). */
function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "PUT, GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    ...(origin !== "*" ? { vary: "Origin" } : {}),
  };
}

/** Build the request handler. `opts`: { store, token, ticketSecret, allowedOrigin, maxBytes, scan }. */
export function createHandler(opts) {
  const store = opts.store;
  const token = opts.token;
  const ticketSecret = opts.ticketSecret;
  const origin = opts.allowedOrigin || "*";
  const limit = opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  const scanOpts = opts.scan ?? {};
  const cors = corsHeaders(origin);

  return async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (method === "GET" && path === "/healthz") return send(res, 200, { ok: true });

    // ── Browser plane: /portal/<key>, ticket-authorised, CORS-enabled ──────────────────────────────
    const portal = path.match(/^\/portal\/([^/?#]+)$/);
    if (portal) {
      if (method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
      const key = decodeURIComponent(portal[1]);
      if (!isValidKey(key)) return send(res, 400, { error: "invalid key" }, cors);
      if (!ticketSecret) return send(res, 503, { error: "portal disabled (no ticket secret)" }, cors);
      const op = method === "PUT" ? "put" : method === "GET" ? "get" : null;
      if (!op) return send(res, 405, { error: "method not allowed" }, cors);
      const payload = verifyTicket(url.searchParams.get("ticket"), ticketSecret, { op, key });
      if (!payload) return send(res, 401, { error: "invalid or expired ticket" }, cors);
      try {
        if (op === "put") {
          const buf = await readBody(req, limit);
          // Scan the bytes BEFORE storing them. A malicious upload is refused here — never written, so it
          // never becomes downloadable and the gateway never records a pointer for it (its record-step HEAD
          // will 404). This is the one place the bytes exist, so it's the only place scanning can happen.
          const verdict = await scanBlob(buf, scanOpts);
          if (!verdict.ok) {
            // eslint-disable-next-line no-console
            console.warn("attachments-broker: upload rejected by scan", { key, reason: verdict.reason });
            return send(res, 422, { error: "rejected by malware scan", reason: verdict.reason }, cors);
          }
          const stored = await store.put(key, buf);
          return send(res, 200, { ok: true, ...stored, ...(verdict.degraded ? { scan: "degraded", degraded: verdict.degraded } : {}) }, cors);
        }
        const bytes = await store.get(key);
        if (!bytes) return send(res, 404, { error: "not found" }, cors);
        // The download ticket may carry the original filename so a direct browser navigation downloads it.
        const name = typeof payload.name === "string" ? payload.name : null;
        res.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
          "x-content-type-options": "nosniff",
          ...(name ? { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } : {}),
          ...cors,
        });
        return res.end(bytes);
      } catch (err) {
        if (err instanceof BodyTooLargeError) return send(res, 413, { error: err.message }, cors);
        // eslint-disable-next-line no-console
        console.error("attachments-broker: portal op failed", { op, key, err: String(err) });
        return send(res, 500, { error: "internal error" }, cors);
      }
    }

    // ── Server plane: /blob/<key>, bearer-token, metadata-only (no bytes to the gateway) ────────────
    const blob = path.match(/^\/blob\/([^/?#]+)$/);
    if (blob) {
      if (token && !bearerOk(req.headers["authorization"], token)) return send(res, 401, { error: "unauthorized" });
      const key = decodeURIComponent(blob[1]);
      if (!isValidKey(key)) return send(res, 400, { error: "invalid key" });
      try {
        if (method === "HEAD") {
          const size = await store.size(key);
          if (size === null) { res.writeHead(404); return res.end(); }
          res.writeHead(200, { "x-attachment-size": String(size) });
          return res.end();
        }
        if (method === "DELETE") {
          const existed = await store.del(key);
          return send(res, existed ? 200 : 404, existed ? { ok: true } : { error: "not found" });
        }
        return send(res, 405, { error: "method not allowed" });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("attachments-broker: blob op failed", { method, key, err: String(err) });
        return send(res, 500, { error: "internal error" });
      }
    }

    return send(res, 404, { error: "not found" });
  };
}

/** Boot the server from the environment. Only runs when executed directly, not when imported. */
export function main() {
  const port = Number(process.env["PORT"] ?? 8091);
  const host = process.env["HOST"]?.trim() || "0.0.0.0";
  const dir = process.env["ATTACHMENTS_BROKER_DIR"]?.trim() || "/data";
  const token = process.env["ATTACHMENTS_BROKER_TOKEN"]?.trim();
  const ticketSecret = process.env["ATTACHMENTS_TICKET_SECRET"]?.trim();
  const allowedOrigin = process.env["ATTACHMENTS_ALLOWED_ORIGIN"]?.trim() || "*";
  const allowAnon = process.env["ATTACHMENTS_BROKER_ALLOW_ANON"] === "1";
  // Malware/AV scan config. Heuristics (EICAR + executable magic) are ALWAYS on; ClamAV is optional.
  const scan = {
    clamavAddress: process.env["ATTACHMENTS_CLAMAV_ADDRESS"]?.trim() || undefined,
    clamavTimeoutMs: Number(process.env["ATTACHMENTS_CLAMAV_TIMEOUT_MS"]) || 30_000,
    failOpen: process.env["ATTACHMENTS_SCAN_FAIL_OPEN"] === "1",
    allowExecutables: process.env["ATTACHMENTS_SCAN_ALLOW_EXECUTABLES"] === "1",
  };
  // Fail closed: the server plane reads/deletes user file bytes, so refuse to serve it unauthenticated
  // unless the operator explicitly opts in (loopback-only dev).
  if (!token && !allowAnon) {
    // eslint-disable-next-line no-console
    console.error(
      "attachments-broker: refusing to start without ATTACHMENTS_BROKER_TOKEN. " +
        "Set the token, or set ATTACHMENTS_BROKER_ALLOW_ANON=1 to accept UNAUTHENTICATED server-plane requests (not for production).",
    );
    process.exit(1);
  }
  if (!ticketSecret) {
    // eslint-disable-next-line no-console
    console.warn("attachments-broker: WARNING — ATTACHMENTS_TICKET_SECRET unset; the browser upload/download portal is DISABLED (503).");
  }
  if (!token && allowAnon) {
    // eslint-disable-next-line no-console
    console.warn(`attachments-broker: WARNING — server plane UNAUTHENTICATED (ATTACHMENTS_BROKER_ALLOW_ANON=1) on ${host}:${port}`);
  }
  const store = createFsStore(dir);
  const handler = createHandler({ store, token: token || undefined, ticketSecret: ticketSecret || undefined, allowedOrigin, scan });
  createServer((req, res) => void handler(req, res)).listen(port, host, () => {
    const av = scan.clamavAddress ? `clamav=${scan.clamavAddress}${scan.failOpen ? " (fail-open)" : ""}` : "clamav=off";
    // eslint-disable-next-line no-console
    console.log(`attachments-broker listening on ${host}:${port} (dir=${dir}, portal=${ticketSecret ? "on" : "off"}, cors=${allowedOrigin}, scan=heuristic+${av})`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
