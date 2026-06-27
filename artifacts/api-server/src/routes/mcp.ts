import { Router } from "express";
import { getSession } from "./auth";
import { hasValidApiToken } from "../lib/api-token";
import { getBroker, contextFromReq } from "../broker";
import { handleMcp, type McpExecutor } from "../lib/mcp";
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

  const ctx = contextFromReq(req);
  const broker = getBroker();
  const exec: McpExecutor = async (tool, args) => {
    if (req.body?.method === "tools/call") {
      recordAudit({ ts: new Date().toISOString(), category: "request", action: `mcp:${tool.name}`, actor: getSession(req) ? { sub: getSession(req)!.sub } : null, projectId: (args["projectId"] as string) ?? null, result: "success", status: 200 });
    }
    switch (tool.action) {
      case "list_projects": return broker.listProjects(ctx);
      case "list_issues": return broker.listIssues(ctx, String(args["projectId"]));
      case "project_summary": return broker.projectSummary(ctx, String(args["projectId"]));
      case "get_portfolio_health": return broker.portfolioHealth(ctx);
      case "get_capabilities": return broker.capabilities(ctx);
      default: throw new Error(`unsupported tool action: ${tool.action}`);
    }
  };

  const response = await handleMcp(body, exec, VERSION);
  if (response === null) { res.status(202).end(); return; } // notification
  res.json(response);
});

export default router;
