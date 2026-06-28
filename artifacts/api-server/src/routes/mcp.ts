import { Router, type Request } from "express";
import { getSession } from "./auth";
import { hasValidApiToken } from "../lib/api-token";
import { hasRole } from "../lib/rbac";
import { getBroker, contextFromReq, type Broker, type ActorContext } from "../broker";
import { handleMcp, type McpExecutor, type McpPolicy } from "../lib/mcp";
import { recordAudit } from "../lib/audit";
import { enforceCapability, CapabilityBlockedError } from "../lib/tools";
import { resolveSupport } from "../lib/capabilities";
import { availableReports, availableScreens } from "@workspace/backend-catalogue";
import type { Role } from "../lib/rbac";

/**
 * MCP endpoint — POST /api/mcp (JSON-RPC 2.0). Lets an MCP client read the
 * portfolio through the broker seam, inheriting capability-gating + audit.
 *
 * Auth here (not the generic requireAuth, which blocks API tokens on non-GET):
 * MCP is POST but the v1 tools are READ-ONLY, so a session OR a read-only API
 * token is accepted — the same principle as the BI/OData read endpoints.
 */
const router = Router();
const VERSION = process.env["npm_package_version"]?.trim() || "0.2.0";

/** The pre-resolved context handed to every MCP tool handler. */
interface McpCtx {
  broker: Broker;
  ctx: ActorContext;
  req: Request;
  /** `projectId` from the tool args (or ""). */
  pid: string;
  args: Record<string, unknown>;
}

/**
 * The MCP tool-action registry — every MCP tool action keyed to the broker call it
 * makes (was a switch). The declared tools live in `MCP_TOOLS` (lib/mcp.ts); this is
 * their execution. A guard test asserts the two sets match exactly, so a tool can
 * never be declared without a handler (or vice versa). The action set OVERLAPS the
 * binding-action registry but isn't a subset — `list_reports`/`list_screens` are
 * cross-plane catalogue actions, not backend binding calls.
 */
const MCP_HANDLERS: Record<string, (d: McpCtx) => Promise<unknown> | unknown> = {
  list_projects: ({ broker, ctx }) => broker.listProjects(ctx),
  list_issues: ({ broker, ctx, pid }) => broker.listIssues(ctx, pid),
  project_summary: ({ broker, ctx, pid }) => broker.projectSummary(ctx, pid),
  get_portfolio_health: ({ broker, ctx }) => broker.portfolioHealth(ctx),
  get_capabilities: ({ broker, ctx }) => broker.capabilities(ctx),
  get_notifications: ({ broker, ctx }) => broker.notifications(ctx),
  // Cross-plane discovery: reports + screens, filtered to what's actually usable so
  // the agent isn't told about a report the backend can't feed or a screen it can't open.
  list_reports: async ({ req }) => {
    // The hard rule, both planes: only reports a connected backend can feed AND
    // (where required) a connected broker supports.
    const support = await resolveSupport(req);
    return availableReports(support).map((r) => ({ id: r.id, label: r.label, kind: r.kind, requiresCapability: r.capabilities.requiresCapability, exports: r.capabilities.exports, produces: r.tools }));
  },
  list_screens: async ({ req }) => {
    // Hard capability rule (availableScreens, both planes) + the separate RBAC role gate.
    const support = await resolveSupport(req);
    return availableScreens(support)
      .filter((s) => hasRole(req, s.capabilities.requiresRole as Role))
      .map((s) => ({ id: s.id, label: s.label, route: s.route, kind: s.kind, requiresRole: s.capabilities.requiresRole, widgets: s.tools }));
  },
  // Gated writes (the policy check in handleMcp already refused unauthorised callers).
  create_issue: ({ broker, ctx, pid, args }) => broker.writeIssue(ctx, "create", { projectId: pid, title: String(args["title"] ?? ""), ...(args["description"] ? { description: String(args["description"]) } : {}), ...(args["status"] ? { status: String(args["status"]) } : {}) }),
  update_issue: ({ broker, ctx, pid, args }) => broker.writeIssue(ctx, "update", { projectId: pid, issueId: String(args["issueId"] ?? ""), ...(args["title"] ? { title: String(args["title"]) } : {}), ...(args["status"] ? { status: String(args["status"]) } : {}), ...(args["expectedVersion"] != null ? { expectedVersion: Number(args["expectedVersion"]) } : {}) }),
  delete_issue: ({ broker, ctx, pid, args }) => broker.writeIssue(ctx, "delete", { projectId: pid, issueId: String(args["issueId"] ?? "") }),
};

/** The MCP tool actions that have an executor (the registry's keys) — the guard
 *  test checks these match the declared MCP_TOOLS exactly. */
export const MCP_HANDLER_ACTIONS: readonly string[] = Object.keys(MCP_HANDLERS);

router.post("/mcp", async (req, res) => {
  const body = (req.body ?? {}) as { id?: string | number | null; method?: string; params?: Record<string, unknown> };
  if (!getSession(req) && !hasValidApiToken(req)) {
    res.status(401).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32001, message: "Unauthorized" } });
    return;
  }

  // Governance gate: the MCP capability must be turned on (off by default). Denials
  // are logged. Returned as a JSON-RPC error so MCP clients see a clean refusal.
  try {
    const s = getSession(req);
    enforceCapability("mcp", { actor: s ? { sub: s.sub, email: s.email } : null });
  } catch (err) {
    if (err instanceof CapabilityBlockedError) {
      res.status(403).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32004, message: "MCP is turned off by the administrator" } });
      return;
    }
    throw err;
  }

  // Write policy: OFF unless MCP_WRITE_ENABLED, and only for a contributor+
  // SESSION (a read-only API token can never write). Here be dragons.
  const writesEnabled = /^(1|true|on|yes)$/i.test(process.env["MCP_WRITE_ENABLED"]?.trim() ?? "");
  const policy: McpPolicy = { writesEnabled, canWrite: writesEnabled && !!getSession(req) && hasRole(req, "contributor") };

  const ctx = contextFromReq(req);
  const broker = getBroker();
  const exec: McpExecutor = async (tool, args) => {
    if (req.body?.method === "tools/call") {
      recordAudit({ ts: new Date().toISOString(), category: tool.write ? "broker" : "request", action: `mcp:${tool.name}`, actor: getSession(req) ? { sub: getSession(req)!.sub } : null, projectId: (args["projectId"] as string) ?? null, write: !!tool.write, result: "success", status: 200 });
    }
    const handler = MCP_HANDLERS[tool.action];
    if (!handler) throw new Error(`unsupported tool action: ${tool.action}`);
    return handler({ broker, ctx, req, pid: String(args["projectId"] ?? ""), args });
  };

  const response = await handleMcp(body, exec, VERSION, policy);
  if (response === null) { res.status(202).end(); return; } // notification
  res.json(response);
});

export default router;
