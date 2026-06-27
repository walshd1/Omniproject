/**
 * PIPEDREAM broker template — an HTTP component.
 *
 * Same broker as reference-broker-blueprint.ts; the only platform code is the
 * Pipedream component wrapper + the synchronous `$.interface.http` response. The
 * binding logic is REUSED from the shared `processBrokerCall` core (no
 * duplication). Implement `backend`, deploy the component, point BROKER_URL at its
 * HTTP endpoint, run conformance.
 */
import { processBrokerCall, backend, type BrokerBackend } from "../reference-broker-blueprint";

const myBackend: BrokerBackend = backend; // TODO: replace the stub with your impl

/** Pipedream injects `this` bound to the component (which carries `http`). */
interface PipedreamHttp {
  respond(o: { status: number; headers?: Record<string, string>; body: unknown }): void;
}
interface PipedreamSelf {
  http: PipedreamHttp;
}
interface HttpEvent {
  body?: unknown;
  headers?: Record<string, string | undefined>;
}

export default {
  name: "omniproject-broker",
  version: "0.1.0",
  props: {
    // A synchronous HTTP source (customResponse lets us return {success,data}).
    http: { type: "$.interface.http", customResponse: true },
  },
  async run(this: PipedreamSelf, { event }: { event: HttpEvent }): Promise<void> {
    const rawBody = typeof event.body === "string" ? event.body : JSON.stringify(event.body ?? {});
    const r = await processBrokerCall(
      { rawBody, actionHeader: event.headers?.["x-omniproject-action"], authHeader: event.headers?.["authorization"] },
      myBackend,
    );
    this.http.respond({ status: r.status, headers: { "Content-Type": "application/json" }, body: r.body });
  },
};
