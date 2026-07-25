import type { Request, Response } from "express";
import { evaluateRuleset } from "./ruleset";
import { roleForReq } from "./rbac";
import { recordAudit } from "./audit";

/**
 * The SINGLE business-ruleset gate every domain write should route through. Historically each route
 * re-implemented the same three lines (evaluate → 422 on a hard block → warning header); that copy-paste
 * is exactly how a write slips through ungoverned (the audit found ~18 domain writes that never called
 * the ruleset at all). This centralises it so a write is one call away from being governed, and it is the
 * seed of the future "action base" — the shared shell every command runs through.
 *
 * RESTRICT-ONLY, and runs AFTER the hard gates (RBAC/scope) and content validation, never before. Returns
 * true to proceed; on a hard block it has already sent `422 { error, rule }` and returns false. Warnings
 * ride the `X-OmniProject-Rule-Warnings` response header (non-blocking), mirroring the issue-route gate.
 */
export function enforceBusinessRules(
  req: Request,
  res: Response,
  action: string,
  opts: { projectId?: string | null; programmeId?: string | null; payload?: Record<string, unknown> } = {},
): boolean {
  const projectId = opts.projectId ?? null;
  const verdict = evaluateRuleset({
    action,
    write: true,
    role: roleForReq(req),
    projectId,
    programmeId: opts.programmeId ?? null,
    payload: opts.payload,
  });
  if (!verdict.allow) {
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: `rule_block:${verdict.blocked!.id}`, projectId, result: "error", status: 422 });
    res.status(422).json({ error: verdict.blocked!.message, rule: verdict.blocked!.id });
    return false;
  }
  if (verdict.warnings.length) res.setHeader("X-OmniProject-Rule-Warnings", verdict.warnings.map((w) => w.id).join(","));
  return true;
}
