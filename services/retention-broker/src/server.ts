/**
 * The retention-broker HTTP service. A tiny node:http server (no framework) exposing
 * `POST /retention/<op>` — the wire contract the gateway's `BrokerRetentionSource` speaks — plus a
 * `GET /healthz`. Optional bearer-token auth via `RETENTION_BROKER_TOKEN`. It holds nothing itself;
 * the durable data lives in the S3/DynamoDB/BigQuery backend behind the retention source.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { retentionSourceFromEnv } from "./retention-source";
import { dispatch, isOp } from "./dispatch";
import { ValidationError } from "./validate";
import type { RetentionSource } from "./contract";

/** Max request-body size. An unbounded buffer is a trivial memory-exhaustion DoS on an open POST. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return reject(new ValidationError("request body too large"));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new ValidationError("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Constant-time bearer check — avoids leaking the token via response-time correlation. */
function bearerOk(header: string | undefined, token: string): boolean {
  const prefix = "Bearer ";
  if (typeof header !== "string" || !header.startsWith(prefix)) return false;
  const got = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(json);
}

/** Build the request handler over a source + optional token — exported for tests. */
export function createHandler(source: RetentionSource, token?: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/healthz") return send(res, 200, { ok: true });
    if (token) {
      if (!bearerOk(req.headers["authorization"], token)) return send(res, 401, { error: "unauthorized" });
    }
    const m = url.match(/^\/retention\/([a-z-]+)$/);
    if (req.method !== "POST" || !m || !isOp(m[1]!)) return send(res, 404, { error: "not found" });
    try {
      const body = await readJson(req);
      send(res, 200, await dispatch(source, m[1]!, body));
    } catch (err) {
      // Client input errors are safe to echo; backend/SDK failures are not (they leak bucket/table
      // names and request ids), so those get a generic 500 with details kept server-side.
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      // eslint-disable-next-line no-console
      console.error("retention-broker: op failed", { op: m[1], err });
      send(res, 500, { error: "internal error" });
    }
  };
}

/** Boot the server from the environment. Only runs when executed directly, not when imported. */
export function main(): void {
  const port = Number(process.env["PORT"] ?? 8090);
  const host = process.env["HOST"]?.trim() || "0.0.0.0";
  const token = process.env["RETENTION_BROKER_TOKEN"]?.trim();
  const allowAnon = process.env["RETENTION_BROKER_ALLOW_ANON"] === "1";
  // Fail closed: the retention ops read/purge the entire durable history store, so refuse to serve
  // them unauthenticated unless the operator explicitly opts in (e.g. a loopback-only dev run).
  if (!token && !allowAnon) {
    // eslint-disable-next-line no-console
    console.error(
      "retention-broker: refusing to start without RETENTION_BROKER_TOKEN. " +
        "Set the token, or set RETENTION_BROKER_ALLOW_ANON=1 to accept UNAUTHENTICATED requests (not for production).",
    );
    process.exit(1);
  }
  if (!token && allowAnon) {
    // eslint-disable-next-line no-console
    console.warn(`retention-broker: WARNING — running UNAUTHENTICATED (RETENTION_BROKER_ALLOW_ANON=1) on ${host}:${port}`);
  }
  const source = retentionSourceFromEnv();
  const handler = createHandler(source, token || undefined);
  createServer((req, res) => void handler(req, res)).listen(port, host, () => {
    // eslint-disable-next-line no-console
    console.log(`retention-broker listening on ${host}:${port} (backend=${process.env["RETENTION_BACKEND"]})`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
