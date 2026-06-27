/**
 * SERVERLESS broker template — deploy on ANY cloud (AWS Lambda, Google Cloud
 * Functions, Azure Functions) or a container.
 *
 * It is the SAME broker as reference-broker-blueprint.ts: the binding logic
 * (envelope parsing, PSK, verify short-circuit, the full action router, the error
 * taxonomy) is REUSED from the shared `processBrokerCall` core. The only code here
 * is the per-platform handler glue + your `backend`. That's the whole point of the
 * shared core — a new broker runtime is a few lines, not a re-implementation.
 *
 * To make it real: implement `backend` (start from the blueprint's stub), deploy
 * the handler for your platform, set BROKER_URL to its URL, run conformance.
 */
import { processBrokerCall, backend, type BrokerBackend } from "../reference-broker-blueprint";

// TODO: implement against your system of record (copy the blueprint's `backend`
// and fill each method). Using the stub here keeps the template compiling.
const myBackend: BrokerBackend = backend;

/** AWS Lambda (Function URL / API Gateway proxy). */
export async function lambdaHandler(event: { body?: string | null; headers?: Record<string, string | undefined> }) {
  const r = await processBrokerCall(
    {
      rawBody: event.body ?? "",
      actionHeader: event.headers?.["x-omniproject-action"],
      authHeader: event.headers?.["authorization"] ?? event.headers?.["Authorization"],
    },
    myBackend,
  );
  return { statusCode: r.status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(r.body) };
}

/** Google Cloud Functions / Azure Functions / a container (Express-like req/res). */
export async function httpHandler(
  req: { body?: unknown; rawBody?: string; headers: Record<string, string | undefined> },
  res: { status: (n: number) => { json: (b: unknown) => void } },
): Promise<void> {
  const rawBody = typeof req.rawBody === "string" ? req.rawBody : JSON.stringify(req.body ?? {});
  const r = await processBrokerCall(
    { rawBody, actionHeader: req.headers["x-omniproject-action"], authHeader: req.headers["authorization"] },
    myBackend,
  );
  res.status(r.status).json(r.body);
}
