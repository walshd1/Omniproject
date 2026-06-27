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
  /** The broker action this tool reads. */
  action: string;
}

/** The read-only tool surface exposed to MCP clients. */
export const MCP_TOOLS: McpTool[] = [
  { name: "omniproject_list_projects", action: "list_projects", description: "List all projects/programmes the signed-in user can see.", inputSchema: { type: "object", properties: {} } },
  { name: "omniproject_list_issues", action: "list_issues", description: "List the work items (issues/tasks/deals) in a project.", inputSchema: { type: "object", properties: { projectId: { type: "string", description: "The project id." } }, required: ["projectId"] } },
  { name: "omniproject_project_summary", action: "project_summary", description: "Get the roll-up summary (totals, completion %, overdue) for a project.", inputSchema: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } },
  { name: "omniproject_portfolio_health", action: "get_portfolio_health", description: "Get portfolio-wide RAG / health across all projects.", inputSchema: { type: "object", properties: {} } },
  { name: "omniproject_capabilities", action: "get_capabilities", description: "Report which capability domains the active backend supports.", inputSchema: { type: "object", properties: {} } },
];

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
export async function handleMcp(req: JsonRpcRequest, exec: McpExecutor, serverVersion: string): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  switch (req.method) {
    case "initialize":
      return ok(id, { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "omniproject", version: serverVersion } });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const name = String(req.params?.["name"] ?? "");
      const args = (req.params?.["arguments"] as Record<string, unknown>) ?? {};
      const tool = toolByName(name);
      if (!tool) return err(id, -32602, `unknown tool: ${name}`);
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
