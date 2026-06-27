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

export type OutputKind =
  | "read-api" // structured read projection (OData-style)
  | "bi-feed" // BI/spreadsheet feed manifest
  | "agent-api" // MCP / tool surface for agents
  | "export" // user-initiated file export
  | "metrics" // observability scrape
  | "events-out" // outbound signed events
  | "events-in"; // inbound event ingest

export interface OutputCapabilities {
  /** Read-only (never mutates a backend through this surface)? */
  readOnly: boolean;
  /** Long-lived stream / scrape vs one-shot? */
  streaming: boolean;
  /** How a caller authenticates to it. */
  auth: "session" | "api-token" | "session-or-token" | "hmac" | "user-action";
}

export interface OutputManifest {
  id: string;
  label: string;
  /** The route (or surface) that serves it. */
  route: string;
  kind: OutputKind;
  capabilities: OutputCapabilities;
  notes?: string;
}

/** A catalogue entry: the manifest + its concrete tools (entity sets / tool names
 *  / formats), kept separate from capabilities but linked here. */
export interface OutputDefinition extends OutputManifest {
  tools: string[];
}

export const OUTPUTS: OutputDefinition[] = [
  {
    id: "mcp", label: "MCP server", route: "POST /api/mcp", kind: "agent-api",
    capabilities: { readOnly: true, streaming: false, auth: "session-or-token" },
    tools: ["omniproject_list_projects", "omniproject_list_issues", "omniproject_project_summary", "omniproject_portfolio_health", "omniproject_capabilities"],
    notes: "JSON-RPC tools for MCP clients/agents; reads through the broker seam (docs/MCP.md).",
  },
  {
    id: "odata", label: "OData / Power BI", route: "GET /api/odata", kind: "read-api",
    capabilities: { readOnly: true, streaming: false, auth: "api-token" },
    tools: ["Projects", "Issues", "Portfolio"],
    notes: "Read-only OData entity sets for Power BI / Excel.",
  },
  {
    id: "bi-feeds", label: "BI feed manifest", route: "GET /api/bi/feeds", kind: "bi-feed",
    capabilities: { readOnly: true, streaming: false, auth: "api-token" },
    tools: ["portfolio_health", "prometheus_metrics"],
    notes: "A manifest of JSON feeds for Power BI / Sheets connectors.",
  },
  {
    id: "metrics", label: "Prometheus metrics", route: "GET /api/metrics", kind: "metrics",
    capabilities: { readOnly: true, streaming: false, auth: "api-token" },
    tools: ["omniproject_http_requests_total", "omniproject_broker_request_duration_ms", "omniproject_portfolio_rag"],
    notes: "RED runtime metrics + portfolio gauges (docs/ops/PILOT-READINESS.md).",
  },
  {
    id: "exports", label: "File exports", route: "GET /api/export.{csv,json,xlsx,pdf,md}", kind: "export",
    capabilities: { readOnly: true, streaming: false, auth: "user-action" },
    tools: ["csv", "json", "xlsx", "pdf", "md"],
    notes: "User-initiated exports with CSV-injection neutralisation + data-lineage.",
  },
  {
    id: "webhooks", label: "Outbound events", route: "subscriptions → HMAC-signed POST", kind: "events-out",
    capabilities: { readOnly: false, streaming: false, auth: "hmac" },
    tools: ["notification", "audit", "config.changed", "webhook.test"],
    notes: "OmniProject signs outbound events; receivers verify the HMAC (Zapier/IFTTT/Make can consume these).",
  },
  {
    id: "notifications-ingest", label: "Notification ingest", route: "POST /api/notifications/ingest", kind: "events-in",
    capabilities: { readOnly: false, streaming: false, auth: "hmac" },
    tools: ["notification"],
    notes: "Inbound: a broker/tool pushes an event in (NOTIFY_INGEST_SECRET).",
  },
  {
    id: "notifications-stream", label: "Live notification stream", route: "GET /api/notifications/stream (SSE)", kind: "events-out",
    capabilities: { readOnly: true, streaming: true, auth: "session" },
    tools: ["notification"],
    notes: "Server-Sent Events to the in-app bell; multi-replica via the notify bus.",
  },
];

export function getOutput(id: string): OutputDefinition | undefined {
  return OUTPUTS.find((o) => o.id === id);
}

export function outputCatalogue(): OutputDefinition[] {
  return OUTPUTS.map((o) => ({ ...o }));
}
