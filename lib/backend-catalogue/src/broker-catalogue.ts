import type { TransportMethod } from "./backend-manifest";

/**
 * BROKER registry — the automation/translation layer that sits between the
 * gateway and a backend. Same architectural principle as the backend catalogue:
 * the broker's **capabilities** (what it can do) are kept separate from its
 * **build tool** (how you stand one up), linked into a `BrokerDefinition`.
 *
 * n8n is the reference broker; everything here is broker-agnostic. The hard line
 * is `capabilities.synchronous` — whether it can answer the binding's
 * request/response in the SAME HTTP call (required to serve read-through). Async
 * platforms (Airflow, and Zapier/IFTTT which aren't even listed as data brokers)
 * can still do scheduled sync + events, but cannot be the live data hop.
 */

/** The brokers OmniProject knows how to be driven by. */
export type BrokerKind =
  | "n8n"
  | "make"
  | "pipedream"
  | "power-automate"
  | "airflow"
  | "serverless"
  | "http-sidecar";

/** How you BUILD a broker for this platform (the linked "tool"). */
export type BrokerBuildMethod =
  | "workflow-generator" // n8n — generated importable workflow
  | "scenario-template" // Make — scenario blueprint
  | "component-template" // Pipedream — HTTP component
  | "flow-template" // Power Automate — cloud flow
  | "dag-template" // Airflow — DAG
  | "function-template" // serverless — portable function
  | "implement-blueprint"; // raw HTTP service — the reference broker blueprint

export interface BrokerCapabilities {
  /** Can return `{success,data}` in the SAME request — required for read-through. */
  synchronous: boolean;
  /** Can you self-host it (vs vendor-hosted only)? */
  selfHostable: boolean;
  /** Provides managed per-connector auth (OAuth/credentials)? */
  managedAuth: boolean;
  /** Can push events into POST /api/notifications/ingest? */
  eventsInbound: boolean;
  /** Can receive OmniProject's outbound HMAC events? */
  eventsOutbound: boolean;
}

/** The broker-neutral description (no build specifics). */
export interface BrokerManifest {
  id: BrokerKind;
  label: string;
  docsUrl: string;
  kind: "low-code" | "code-first" | "serverless" | "self-hosted-service";
  /** Vendor-hosted (true) or you run it (false / both). */
  hosted: boolean;
  capabilities: BrokerCapabilities;
  /** Which backend transports this broker can drive (native-node is n8n-only). */
  transports: TransportMethod[];
  notes?: string;
}

/** A catalogue entry: the manifest + its linked build tool. */
export interface BrokerDefinition extends BrokerManifest {
  build: BrokerBuildMethod;
}

const HTTP: TransportMethod[] = ["http"];

export const BROKERS: BrokerDefinition[] = [
  {
    id: "n8n", label: "n8n", docsUrl: "https://docs.n8n.io/", kind: "low-code", hosted: false,
    capabilities: { synchronous: true, selfHostable: true, managedAuth: true, eventsInbound: true, eventsOutbound: true },
    transports: ["http", "native-node"], build: "workflow-generator",
    notes: "The reference broker. Self-hostable, maintained nodes for most backends, synchronous webhook response.",
  },
  {
    id: "make", label: "Make (Integromat)", docsUrl: "https://www.make.com/en/help/tools/webhooks", kind: "low-code", hosted: true,
    capabilities: { synchronous: true, selfHostable: false, managedAuth: true, eventsInbound: true, eventsOutbound: true },
    transports: HTTP, build: "scenario-template",
    notes: "Custom webhook + Webhook Response modules return a synchronous body — a drop-in n8n alternative for the full contract.",
  },
  {
    id: "pipedream", label: "Pipedream", docsUrl: "https://pipedream.com/docs/", kind: "code-first", hosted: true,
    capabilities: { synchronous: true, selfHostable: false, managedAuth: true, eventsInbound: true, eventsOutbound: true },
    transports: HTTP, build: "component-template",
    notes: "Code-first components on an HTTP source can `$respond()` synchronously — a strong fit for the binding.",
  },
  {
    id: "power-automate", label: "Microsoft Power Automate", docsUrl: "https://learn.microsoft.com/en-us/power-automate/", kind: "low-code", hosted: true,
    capabilities: { synchronous: true, selfHostable: false, managedAuth: true, eventsInbound: true, eventsOutbound: true },
    transports: HTTP, build: "flow-template",
    notes: "An HTTP-request-triggered cloud flow with a Response action serves the contract (premium connector). Native Microsoft 365 / Dataverse reach.",
  },
  {
    id: "airflow", label: "Apache Airflow", docsUrl: "https://airflow.apache.org/docs/", kind: "code-first", hosted: false,
    capabilities: { synchronous: false, selfHostable: true, managedAuth: false, eventsInbound: true, eventsOutbound: false },
    transports: HTTP, build: "dag-template",
    notes: "Batch/scheduled DAGs — NOT a live read-through broker (no synchronous response). Use it to sync a backend into a store that a real broker reads, or to push events. Honest limit, like Zapier.",
  },
  {
    id: "serverless", label: "Serverless function (any cloud)", docsUrl: "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html", kind: "serverless", hosted: false,
    capabilities: { synchronous: true, selfHostable: true, managedAuth: false, eventsInbound: true, eventsOutbound: true },
    transports: HTTP, build: "function-template",
    notes: "One HTTP function (Lambda / Cloud Functions / Azure Functions / a container) implementing the binding. Deploy anywhere; you wire backend auth yourself.",
  },
  {
    id: "http-sidecar", label: "Custom HTTP sidecar", docsUrl: "https://github.com/walshd1/omniproject/blob/main/docs/BROKER-HTTP-BINDING.md", kind: "self-hosted-service", hosted: false,
    capabilities: { synchronous: true, selfHostable: true, managedAuth: false, eventsInbound: true, eventsOutbound: true },
    transports: HTTP, build: "implement-blueprint",
    notes: "A service you write against the binding (see reference-broker-blueprint.ts). Maximum control; the DB-backed broker (RFC-003) is one.",
  },
];

export function getBrokerDef(id: string): BrokerDefinition | undefined {
  return BROKERS.find((b) => b.id === id);
}

/** Brokers that can act as the live DATA hop for a backend transport: synchronous
 *  AND able to drive that transport. (native-node ⇒ n8n only; http ⇒ every
 *  synchronous HTTP broker — Airflow is excluded, it's async.) */
export function brokersForTransport(t: TransportMethod): BrokerKind[] {
  return BROKERS.filter((b) => b.capabilities.synchronous && b.transports.includes(t)).map((b) => b.id);
}

/** Lightweight catalogue view (capabilities + linked build method per broker). */
export function brokerCatalogue() {
  return BROKERS.map((b) => ({
    id: b.id,
    label: b.label,
    docsUrl: b.docsUrl,
    kind: b.kind,
    hosted: b.hosted,
    capabilities: b.capabilities,
    transports: b.transports,
    build: b.build,
    /** Can it serve the live read-through contract at all? */
    dataBroker: b.capabilities.synchronous,
    notes: b.notes,
  }));
}
