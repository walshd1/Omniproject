import type { TransportMethod } from "./backend-manifest";
import type { CrossPlaneRef } from "./planes";
import { BROKERS_DATA } from "./vendors.generated";

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
  /** Other planes this broker also offers — a broker can span planes (e.g. an n8n
   *  workflow that also delivers to Slack). */
  alsoProvides?: CrossPlaneRef[];
  notes?: string;
}

/** A catalogue entry: the manifest + its linked build tool. */
export interface BrokerDefinition extends BrokerManifest {
  build: BrokerBuildMethod;
}

export const BROKERS: BrokerDefinition[] = BROKERS_DATA;

/** One broker definition by id, or undefined. */
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
    alsoProvides: b.alsoProvides ?? [],
    /** Can it serve the live read-through contract at all? */
    dataBroker: b.capabilities.synchronous,
    notes: b.notes,
  }));
}
