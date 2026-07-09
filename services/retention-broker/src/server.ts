/**
 * The retention-broker HTTP service. A tiny node:http server (no framework) exposing
 * `POST /retention/<op>` — the wire contract the gateway's `BrokerRetentionSource` speaks — plus a
 * `GET /healthz`. Optional bearer-token auth via `RETENTION_BROKER_TOKEN`. It holds nothing itself;
 * the durable data lives in the S3/DynamoDB/BigQuery backend behind the retention source.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { retentionSourceFromEnv } from "./retention-source";
import { dispatch, isOp } from "./dispatch";
import type { RetentionSource } from "./contract";

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
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
      const auth = req.headers["authorization"];
      if (auth !== `Bearer ${token}`) return send(res, 401, { error: "unauthorized" });
    }
    const m = url.match(/^\/retention\/([a-z-]+)$/);
    if (req.method !== "POST" || !m || !isOp(m[1]!)) return send(res, 404, { error: "not found" });
    try {
      const body = await readJson(req);
      send(res, 200, await dispatch(source, m[1]!, body));
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : "bad request" });
    }
  };
}

/** Boot the server from the environment. Only runs when executed directly, not when imported. */
export function main(): void {
  const port = Number(process.env["PORT"] ?? 8090);
  const token = process.env["RETENTION_BROKER_TOKEN"]?.trim();
  const source = retentionSourceFromEnv();
  const handler = createHandler(source, token || undefined);
  createServer((req, res) => void handler(req, res)).listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`retention-broker listening on :${port} (backend=${process.env["RETENTION_BACKEND"]})`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
