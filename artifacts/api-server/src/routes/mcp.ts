import { Router, type Request } from "express";
import { getSession } from "./auth";
import { hasValidApiToken } from "../lib/api-token";
import { hasRole, isDeprovisioned, roleForReq } from "../lib/rbac";
import { envFlag } from "../lib/env";
import { getBroker, contextFromReq, type Broker, type ActorContext } from "../broker";
import { handleMcp, type McpExecutor, type McpPolicy } from "../lib/mcp";
import { isActionApproved, listApprovedVocab, approvalContextFromReq } from "../lib/approved-actions";
import { answerCopilot } from "../lib/copilot";
import { aiChat } from "../lib/ai";
import { recordAudit, actorForAudit } from "../lib/audit";
import { enforceCapability, CapabilityBlockedError } from "../lib/capability-governance";
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
  // Portfolio copilot as an action — read-only NL Q&A. Runs THROUGH the same scoped,
  // injection-hardened path as the SPA copilot (lib/copilot): only the minimal aggregated
  // snapshot reaches the model, and no further action surface is exposed.
  portfolio_copilot: async ({ broker, ctx, req, args }) => answerCopilot({
    question: String(args["question"] ?? ""),
    broker, ctx,
    vocab: listApprovedVocab(),
    mode: args["mode"] === "freeform" ? "freeform" : "rag",
    ...(typeof args["methodology"] === "string" ? { methodology: args["methodology"] } : {}),
    // Carry the same AI-governance context the SPA path supplies (routes/ai.ts govCtx), so the
    // per-role model allowlist and per-scope token budget apply on the MCP channel too — otherwise
    // an MCP client / read-only API token would evade AI_MODEL_ALLOWLIST + AI_TOKEN_BUDGET entirely.
    complete: async (messages) => (await aiChat(messages, { scope: getSession(req)?.sub, role: roleForReq(req) })).content,
  }),
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
  // MCP is mounted OUTSIDE the generic requireAuth (to allow read-only API tokens), so the
  // SCIM-deprovisioning check that requireAuth does for sessions must be repeated here — else
  // a deactivated user whose session hasn't expired could still act through MCP.
  if (getSession(req) && isDeprovisioned(req)) {
    res.status(403).json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32002, message: "Account has been deactivated." } });
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
  const writesEnabled = envFlag("MCP_WRITE_ENABLED");
  const policy: McpPolicy = { writesEnabled, canWrite: writesEnabled && !!getSession(req) && hasRole(req, "contributor") };

  const ctx = contextFromReq(req);
  const broker = getBroker();
  const exec: McpExecutor = async (tool, args) => {
    const audit = req.body?.method === "tools/call";
    const auditBase = { ts: new Date().toISOString(), category: (tool.write ? "broker" : "request") as "broker" | "request", action: `mcp:${tool.name}`, actor: actorForAudit(req), projectId: (args["projectId"] as string) ?? null, write: !!tool.write };
    try {
      // Hard limit: only the customer's APPROVED actions can execute, whatever the agent asks.
      // Scoped approvals are checked with the caller's role + active backend (the MCP channel
      // has no SPA surface, so a surface-scoped approval is SPA-only and won't satisfy here).
      if (!isActionApproved(tool.action, approvalContextFromReq(req)))
        throw new Error(`action "${tool.action}" is not on the approved allowlist for this caller/backend`);
      const handler = MCP_HANDLERS[tool.action];
      if (!handler) throw new Error(`unsupported tool action: ${tool.action}`);
      const result = await handler({ broker, ctx, req, pid: String(args["projectId"] ?? ""), args });
      // Audit the REAL outcome: record success only after the handler resolves (was logged as
      // success before the approval check + broker call ran, so blocked/failed writes read as OK).
      if (audit) recordAudit({ ...auditBase, result: "success", status: 200 });
      return result;
    } catch (err) {
      if (audit) recordAudit({ ...auditBase, result: "error", status: 500 });
      throw err;
    }
  };

  const response = await handleMcp(body, exec, VERSION, policy);
  if (response === null) { res.status(202).end(); return; } // notification
  res.json(response);
});

export default router;
