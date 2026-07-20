/**
 * OUTPUT registry — the outward interfaces that expose portfolio data/events to
 * the outside world (BI tools, agents, scrapers, webhooks). Same architectural
 * principle as backends and brokers: an output's **capabilities** (read-only?
 * streaming? how it authenticates?) are kept separate from its **tools** (the
 * concrete surface — entity sets, MCP tool names, export formats), linked into
 * one `OutputDefinition`.
 *
 * Outputs are NOT brokers and NOT backends: data flows OUT through them, always
 * through the same broker seam + RBAC + audit, so they add no at-rest scope.
 */
import { OUTPUTS_DATA } from "./vendors.generated";
import { withOverlay } from "./vendor-overlay";
import { matchesMethodology } from "./methodology-match";

export type OutputKind =
  | "read-api" // structured read projection (OData-style)
  | "bi-feed" // BI/spreadsheet feed manifest
  | "agent-api" // MCP / tool surface for agents
  | "export" // user-initiated file export
  | "metrics" // observability scrape
  | "events-out" // outbound signed events
  | "events-in" // inbound event ingest
  | "batch-egress" // scheduled/batch data egress (async orchestrators — Airflow, etc.)
  | "calendar"; // publish scheduled work (milestones/deadlines/task dates) to an external calendar

/** How OmniProject connects to an output — e.g. a calendar reached over its REST API vs an MCP
 *  server, or served as an iCalendar subscription feed. Most outputs have a single implicit
 *  transport (their route) and omit this. */
export type OutputTransport = "api" | "mcp" | "ical-feed";

export interface OutputCapabilities {
  /** Read-only (never mutates a backend through this surface)? */
  readOnly: boolean;
  /** Long-lived stream / scrape vs one-shot? */
  streaming: boolean;
  /** How a caller authenticates to it. */
  auth: "session" | "api-token" | "session-or-token" | "hmac" | "user-action" | "oauth2";
}

export interface OutputManifest {
  id: string;
  label: string;
  /** The route (or surface) that serves it. */
  route: string;
  kind: OutputKind;
  capabilities: OutputCapabilities;
  /** The connection methods offered for this output (e.g. `["api","mcp"]` for a calendar). */
  transports?: OutputTransport[];
  /** Methodology TAGS — like reports/views/screens, so an output can be grouped and preloaded per
   *  methodology (admin/PMO-editable). Neutral (omitted / `"*"`) ⇒ applies to every methodology. */
  methodologies?: string[];
  notes?: string;
}

/** A catalogue entry: the manifest + its concrete tools (entity sets / tool names
 *  / formats), kept separate from capabilities but linked here. */
export interface OutputDefinition extends OutputManifest {
  tools: string[];
}

export const OUTPUTS: OutputDefinition[] = OUTPUTS_DATA;

/** One output-interface definition by id, or undefined. */
export function getOutput(id: string): OutputDefinition | undefined {
  return withOverlay("outputs", OUTPUTS).find((o) => o.id === id);
}

/** Outputs tagged with a methodology — those carrying its tag, plus the neutral (untagged / `"*"`) ones. */
export function outputsForMethodology(methodology: string): OutputDefinition[] {
  return OUTPUTS.filter((o) => matchesMethodology(o.methodologies, methodology));
}

/** All output-interface definitions (a defensive copy). */
export function outputCatalogue(): OutputDefinition[] {
  return withOverlay("outputs", OUTPUTS).map((o) => ({ ...o }));
}
