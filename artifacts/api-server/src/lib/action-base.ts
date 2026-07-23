import type { IRouter, Request, Response } from "express";
import { requireRole, type Role } from "./rbac";
import { recordAudit, actorForAudit, type AuditCategory } from "./audit";
import { enforceBusinessRules } from "./ruleset-guard";

/**
 * LANE 2 — the generic ACTION base. A VERB / command (approve a proposal, run a workflow, transition a
 * timesheet) keeps its irreducible CORE (`run`), but the SHELL around it is the same every time: authorize
 * → validate the args → (business ruleset) → run → audit → respond, with a consistent error envelope. Each
 * cross-cutting step maps to a helper the codebase already applies by hand, per route; this base assembles
 * them from a descriptor so a command can't ship missing one. It's the action twin of the entity pipeline:
 * mountEntity is for noun writes, mountCommand for verb writes.
 *
 * A command's args often bundle more than the request body (the resolved actor, a parsed id, …), so `parse`
 * returns the whole typed args object (or null, having already sent a 4xx). Passkey/eligibility checks that
 * live inside the service stay there — the base standardises the shell, not the core.
 */

export type CommandMethod = "post" | "put" | "patch" | "delete";

export interface CommandDescriptor<A> {
  /** Stable command name — audit fallback + the ratchet label. */
  name: string;
  method: CommandMethod;
  /** Route path, e.g. "/approvals/:id/decision". */
  path: string;
  /** Optional RBAC floor (requireRole). Omit for "any authenticated session" (finer eligibility lives in `parse`). */
  role?: Role;
  /** Authorize + validate the request into typed args, or return null having ALREADY sent a 4xx. */
  parse: (req: Request, res: Response) => A | null;
  /** Optional business-ruleset action, when the command mutates a rule-governed entity. */
  ruleAction?: string;
  /** Scope + payload for the ruleset, when `ruleAction` is set. */
  ruleScope?: (req: Request, args: A) => { projectId?: string | null; programmeId?: string | null; payload?: Record<string, unknown> };
  /** The effect. Returns the response payload (sent with `status`), or `undefined` if it already responded. */
  run: (req: Request, res: Response, args: A) => Promise<unknown>;
  /** Audit action label, or a fn deriving it from args (e.g. `approval.${decision}`). */
  audit: string | ((args: A) => string);
  auditCategory?: AuditCategory;
  /** Extra audit meta, computed after the run (e.g. the resulting status). */
  auditMeta?: (req: Request, args: A, result: unknown) => Record<string, unknown>;
  /** Map a thrown error to a response (e.g. the approval service's typed failures). Default: rethrow. */
  onError?: (res: Response, err: unknown, req: Request, action: string) => void;
  /** Success status when `run` returns a payload (default 200). */
  status?: number;
}

/** The "METHOD /path" this command contributes — for the write-lane ratchet. */
export function commandRoutes<A>(desc: CommandDescriptor<A>): string[] {
  return [`${desc.method.toUpperCase()} ${desc.path}`];
}

/** Mount a command descriptor, running the fixed shell: (role) → parse → ruleset → run → audit → respond. */
export function mountCommand<A>(router: IRouter, desc: CommandDescriptor<A>): void {
  const handler = async (req: Request, res: Response): Promise<void> => {
    const args = desc.parse(req, res);
    if (args === null) return;
    const action = typeof desc.audit === "function" ? desc.audit(args) : desc.audit;
    if (desc.ruleAction) {
      const scope = desc.ruleScope?.(req, args) ?? {};
      if (!enforceBusinessRules(req, res, desc.ruleAction, scope)) return;
    }
    try {
      const result = await desc.run(req, res, args);
      recordAudit({
        ts: new Date().toISOString(),
        category: desc.auditCategory ?? "request",
        action,
        actor: actorForAudit(req),
        write: true,
        result: "success",
        ...(desc.auditMeta ? { meta: desc.auditMeta(req, args, result) } : {}),
      });
      if (result !== undefined) res.status(desc.status ?? 200).json(result);
    } catch (err) {
      if (desc.onError) desc.onError(res, err, req, action);
      else throw err;
    }
  };
  const mw = desc.role ? [requireRole(desc.role), handler] : [handler];
  router[desc.method](desc.path, ...mw);
}
