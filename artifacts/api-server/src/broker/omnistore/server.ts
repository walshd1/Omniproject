import http from "node:http";
import fs from "node:fs";
import { sealPayload } from "../../lib/broker-psk";
import { signBrokerResponse } from "../../lib/broker-hmac";
import { processBrokerCall } from "../reference-broker-blueprint";
import { loadOmniStoreBackend } from "./backend";

/**
 * OmniStore HTTP server — the deployable BACKEND container. It speaks the broker sidecar wire contract
 * (processBrokerCall + PSK envelope + HMAC response signing + 429 backpressure), so ANY broker pointed
 * at it (BROKER_URL / SQL_SIDECAR_URL) uses it. Storage is the durable, encrypted, hash-chained
 * OmniStore engine: state is sealed to OMNISTORE_FILE on every write (write-through) and decrypted +
 * chain-verified on boot (fail-closed on tamper).
 *
 * Env: PORT, OMNISTORE_FILE (durable path), OMNISTORE_KEY (base64-32; else derived), BROKER_PSK,
 * SIDECAR_MAX_INFLIGHT (backpressure).
 */

export interface OmniStoreServerOptions {
  /** Durable sealed-log path. Omit ⇒ in-memory (ephemeral). */
  file?: string;
  /** Reject with 429 while more than this many requests are in flight (0 ⇒ unlimited). */
  maxInflight?: number;
  /** Deterministic 429 for the first N requests (tests). */
  rejectFirst?: number;
}

function tooManyRequests(res: http.ServerResponse, retryAfterSec = 0): void {
  res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) });
  res.end(JSON.stringify({ success: false, code: "rate_limited", message: "omnistore is shedding load (backpressure)" }));
}

/** Build (but don't start) the OmniStore backend server. */
export function createOmniStoreServer(opts: OmniStoreServerOptions = {}): http.Server {
  const file = opts.file ?? process.env["OMNISTORE_FILE"]?.trim();
  const persist = file ? (sealed: string): void => fs.writeFileSync(file, sealed, { mode: 0o600 }) : undefined;
  const initial = file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const backend = loadOmniStoreBackend(initial, persist); // decrypt + chain-verify on boot (throws on tamper)

  const maxInflight = opts.maxInflight ?? (Number(process.env["SIDECAR_MAX_INFLIGHT"]) || 0);
  let rejectFirst = opts.rejectFirst ?? 0;
  let inflight = 0;

  return http.createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    if (rejectFirst > 0) { rejectFirst--; tooManyRequests(res); return; }
    if (maxInflight > 0 && inflight >= maxInflight) { tooManyRequests(res); return; }
    inflight++;
    res.on("close", () => { inflight--; });

    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      void processBrokerCall(
        { rawBody: raw, actionHeader: req.headers["x-omniproject-action"] as string | undefined, authHeader: req.headers["authorization"] as string | undefined, headers: req.headers },
        backend,
      ).then((r) => {
        if (res.writableEnded) return;
        const text = JSON.stringify(r.body);
        const wire = r.encrypted ? JSON.stringify({ v: 2, enc: sealPayload(text) }) : text;
        const rs = signBrokerResponse(wire, r.bind);
        res.writeHead(r.status, { "Content-Type": "application/json", "X-OmniProject-Origin": "omniproject", "X-Omni-Resp-Sig": rs.sig, "X-Omni-Resp-Ts": String(rs.ts) });
        res.end(wire);
      }).catch(() => { if (!res.writableEnded) res.writeHead(500).end(); });
    });
  });
}

// Runnable as the container entrypoint: `node omnistore` (or tsx src/broker/omnistore/server.ts).
if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("omnistore")) {
  const port = Number(process.env["PORT"]) || 5702;
  createOmniStoreServer().listen(port, () => console.log(`OmniStore backend listening on :${port} (point BROKER_URL / SQL_SIDECAR_URL here)`));
}
