import { Router } from "express";
import { getSession } from "./auth";
import { hasValidApiToken } from "../lib/api-token";
import { hasRole } from "../lib/rbac";
import { getBroker, contextFromReq } from "../broker";
import { handleMcp, type McpExecutor, type McpPolicy } from "../lib/mcp";
import { recordAudit } from "../lib/audit";

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

router.post("/mcp", async (req, res) => {
  const body = (req.body ?? {}) as { id?: string | number | null; method?: string; params?: Record<string, unknown> };
  if (!getSession(req) && !hasValidApiToken(req)) {
    res.status(401).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32001, message: "Unauthorized" } });
    return;
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
    const pid = String(args["projectId"] ?? "");
    switch (tool.action) {
      case "list_projects": return broker.listProjects(ctx);
      case "list_issues": return broker.listIssues(ctx, pid);
      case "project_summary": return broker.projectSummary(ctx, pid);
      case "get_portfolio_health": return broker.portfolioHealth(ctx);
      case "get_capabilities": return broker.capabilities(ctx);
      // Gated writes (the policy check in handleMcp already refused unauthorised callers).
      case "create_issue": return broker.writeIssue(ctx, "create", { projectId: pid, title: String(args["title"] ?? ""), ...(args["description"] ? { description: String(args["description"]) } : {}), ...(args["status"] ? { status: String(args["status"]) } : {}) });
      case "update_issue": return broker.writeIssue(ctx, "update", { projectId: pid, issueId: String(args["issueId"] ?? ""), ...(args["title"] ? { title: String(args["title"]) } : {}), ...(args["status"] ? { status: String(args["status"]) } : {}), ...(args["expectedVersion"] != null ? { expectedVersion: Number(args["expectedVersion"]) } : {}) });
      case "delete_issue": return broker.writeIssue(ctx, "delete", { projectId: pid, issueId: String(args["issueId"] ?? "") });
      default: throw new Error(`unsupported tool action: ${tool.action}`);
    }
  };

  const response = await handleMcp(body, exec, VERSION, policy);
  if (response === null) { res.status(202).end(); return; } // notification
  res.json(response);
});

export default router;
