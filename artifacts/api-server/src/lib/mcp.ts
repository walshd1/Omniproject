/**
 * MCP (Model Context Protocol) server — OmniProject "speaks MCP" so any MCP
 * client (Claude Desktop, an IDE, an agent) can read the portfolio through the
 * SAME broker seam, RBAC and audit as everything else. It is an OUTWARD interface
 * (like the OData / BI / metrics endpoints), not a broker: tools resolve to
 * contract reads via `getBroker()`, so the overlay stays stateless and the agent
 * inherits capability-gating + the audit trail for free.
 *
 * Dependency-free by design (matching the project's frugality): MCP is JSON-RPC
 * 2.0, so this implements the protocol directly over the existing Express
 * endpoint — no SDK committed. v1 is READ-ONLY (writes are a deliberately-gated
 * follow-up). The route (routes/mcp.ts) supplies the executor bound to the real
 * broker + request context; this module is the pure protocol + tool registry.
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** The broker action this tool maps to. */
  action: string;
  /** Mutating tool — gated behind MCP_WRITE_ENABLED + a contributor+ session. */
  write?: boolean;
}

// ⚠️ HERE BE DRAGONS — MCP writes let an AGENT mutate your real backend through
// the gateway. They are OFF unless MCP_WRITE_ENABLED is set AND the caller holds a
// contributor+ session (never a read-only API token). The warning is repeated in
// every write tool's description so the model sees it too.
const DRAGONS = "⚠️ WRITE — mutates the real backend. An agent calling this changes live data. Confirm intent before use.";

/** Read tools (always available to any authed principal). */
const READ_TOOLS: McpTool[] = [
  { name: "omniproject_list_projects", action: "list_projects", description: "List all projects/programmes the signed-in user can see.", inputSchema: { type: "object", properties: {} } },
  { name: "omniproject_list_issues", action: "list_issues", description: "List the work items (issues/tasks/deals) in a project.", inputSchema: { type: "object", properties: { projectId: { type: "string", description: "The project id." } }, required: ["projectId"] } },
  { name: "omniproject_project_summary", action: "project_summary", description: "Get the roll-up summary (totals, completion %, overdue) for a project.", inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
  { name: "omniproject_portfolio_health", action: "get_portfolio_health", description: "Get portfolio-wide RAG / health across all projects.", inputSchema: { type: "object", properties: {} } },
  { name: "omniproject_capabilities", action: "get_capabilities", description: "Report which capability domains the active backend supports.", inputSchema: { type: "object", properties: {} } },
  // Plane discovery — let an agent see which REPORTS and SCREENS are available
  // (capability/role-filtered to what this backend + caller can actually use), so
  // it can reason about "show me the EVM report" / "open the Gantt screen".
  { name: "omniproject_list_reports", action: "list_reports", description: "List the report/visualisation types available for the active backend (Gantt, burndown, EVM, …), filtered to the capabilities this backend supports.", inputSchema: { type: "object", properties: {} } },
  { name: "omniproject_list_screens", action: "list_screens", description: "List the SPA screens/views available to the signed-in user (filtered by their role and the backend's capabilities), with each screen's route.", inputSchema: { type: "object", properties: {} } },
  { name: "omniproject_list_notifications", action: "get_notifications", description: "List the signed-in user's recent notifications/alerts (the MCP notification channel — pull-based).", inputSchema: { type: "object", properties: {} } },
];

/** Write tools (gated — see DRAGONS). Advertised only when writes are enabled. */
const WRITE_TOOLS: McpTool[] = [
  { name: "omniproject_create_issue", action: "create_issue", write: true, description: `Create a work item in a project. ${DRAGONS}`, inputSchema: { type: "object", properties: { projectId: { type: "string" }, title: { type: "string" }, description: { type: "string" }, status: { type: "string" } }, required: ["projectId", "title"] } },
  { name: "omniproject_update_issue", action: "update_issue", write: true, description: `Update a work item. Pass expectedVersion for optimistic concurrency. ${DRAGONS}`, inputSchema: { type: "object", properties: { projectId: { type: "string" }, issueId: { type: "string" }, title: { type: "string" }, status: { type: "string" }, expectedVersion: { type: "number" } }, required: ["projectId", "issueId"] } },
  { name: "omniproject_delete_issue", action: "delete_issue", write: true, description: `Delete a work item — IRREVERSIBLE. ${DRAGONS}`, inputSchema: { type: "object", properties: { projectId: { type: "string" }, issueId: { type: "string" } }, required: ["projectId", "issueId"] } },
];

/** The full tool surface (reads + gated writes). */
export const MCP_TOOLS: McpTool[] = [...READ_TOOLS, ...WRITE_TOOLS];

export function toolByName(name: string): McpTool | undefined {
  return MCP_TOOLS.find((t) => t.name === name);
}

// ── JSON-RPC 2.0 ─────────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}
type JsonRpcResponse = { jsonrpc: "2.0"; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string } });

const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
const err = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Runs a tool's underlying broker read. Provided by the route (bound to the real
 *  broker + the authenticated request context). Throws on backend failure. */
export type McpExecutor = (tool: McpTool, args: Record<string, unknown>) => Promise<unknown>;

/**
 * Handle one JSON-RPC message. Returns the response object, or `null` for a
 * notification (no `id`) — the caller should then send 202/no body. Pure: all
 * side effects go through `exec`.
 */
/** Write policy for this caller (computed by the route from env + RBAC). */
export interface McpPolicy {
  /** MCP_WRITE_ENABLED — writes are off by default (here be dragons). */
  writesEnabled: boolean;
  /** This caller may write (contributor+ session, never a read-only token). */
  canWrite: boolean;
}

export async function handleMcp(req: JsonRpcRequest, exec: McpExecutor, serverVersion: string, policy: McpPolicy = { writesEnabled: false, canWrite: false }): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  // Advertise write tools only when writes are enabled (a disabled server looks
  // read-only to the client).
  const visibleTools = policy.writesEnabled ? MCP_TOOLS : READ_TOOLS;

  switch (req.method) {
    case "initialize":
      return ok(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "omniproject", version: serverVersion } });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: visibleTools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = String(req.params?.["name"] ?? "");
      const args = (req.params?.["arguments"] as Record<string, unknown>) ?? {};
      const tool = toolByName(name);
      if (!tool) return err(id, -32602, `unknown tool: ${name}`);
      // Gate writes: disabled server OR insufficient privilege → refuse loudly.
      if (tool.write) {
        if (!policy.writesEnabled) return err(id, -32004, "MCP writes are disabled — set MCP_WRITE_ENABLED to allow them (here be dragons).");
        if (!policy.canWrite) return err(id, -32004, "MCP writes require a contributor+ session (not a read-only token).");
      }
      for (const reqd of tool.inputSchema.required ?? []) {
        if (args[reqd] === undefined || args[reqd] === null || args[reqd] === "") {
          return err(id, -32602, `missing required argument: ${reqd}`);
        }
      }
      try {
        const data = await exec(tool, args);
        // MCP tool results are content blocks; we return the JSON as text.
        return ok(id, { content: [{ type: "text", text: JSON.stringify(data) }] });
      } catch (e) {
        // Tool failures are returned as an isError result (so the model sees them),
        // not a protocol error — but never leak internals.
        const message = e instanceof Error ? e.message : "tool execution failed";
        return ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return err(id, -32601, `method not found: ${req.method ?? ""}`);
  }
}
