import type { IRouter, Request, Response, RequestHandler } from "express";
import { requireRole, type Role } from "./rbac";
import { recordAudit, actorForAudit, type AuditCategory } from "./audit";
import { enforceBusinessRules } from "./ruleset-guard";

/**
 * LANE 2 — the generic ACTION base. A VERB / command (approve a proposal, run a workflow, transition a
 * timesheet) keeps its irreducible CORE (`run`), but the SHELL around it is the same every time: authorize
 * → validate the args → business ruleset → run → audit → respond, with a consistent error envelope. The
 * ruleset always runs (keyed on `ruleAction`, else the command name), so a portfolio freeze or an
 * any-write field rule covers verb writes exactly as it covers entity writes. Each
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
  /** Extra middleware gates applied AFTER the role floor, before the handler — e.g. `requireStepUp`,
   *  `requireEntitlement("x")`, `requireAnyRole(...)`. The action base runs them in order, so a command
   *  with a multi-gate stack stays on the spine instead of falling back to a hand-written route. */
  gates?: RequestHandler[];
  /** Authorize + validate the request into typed args, or return null having ALREADY sent a 4xx. */
  parse: (req: Request, res: Response) => A | null;
  /** Scope + payload for the ruleset (project/programme for scope-tightened overrides, payload for field
   *  rules). Optional — a command with no rule-governed scope can omit it; the ruleset still runs (write-wide
   *  rules like `read-only` apply) with an empty scope. */
  ruleScope?: (req: Request, args: A) => { projectId?: string | null; programmeId?: string | null; payload?: Record<string, unknown> };
  /** Business-ruleset action for this command. Optional — when omitted the command `name` is used, so
   *  EVERY command checks the ruleset (a portfolio `read-only` freeze and `any-write` field rules cover
   *  every spine write by construction). Set it explicitly to align with a named domain action
   *  ("update_task"), or to reuse an existing rule's action label. Non-applicable rules are ignored, so a
   *  command whose name matches no rule simply passes the ruleset unless a write-wide rule is active. */
  ruleAction?: string;
  /** The effect. Returns the response payload (sent with `status`), or `undefined` if it already responded. */
  run: (req: Request, res: Response, args: A) => Promise<unknown>;
  /** Audit action label, or a fn deriving it from args (e.g. `approval.${decision}`). */
  audit: string | ((args: A) => string);
  auditCategory?: AuditCategory;
  /** Optional HTTP status to stamp on the audit record (the `status` field). Omit to leave it unset — set
   *  it to match a route that recorded a fixed status (e.g. 200) so the migrated audit stays byte-identical. */
  auditStatus?: number;
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
    // Every command checks the business ruleset by construction — `ruleAction` when given, else the command
    // name. Non-applicable rules are ignored, so this is a no-op under default config; when a write-wide rule
    // (a `read-only` freeze, an `any-write` field rule) is active it now covers verb writes too, not just
    // entity writes. Runs after parse (the 4xx gate) and before run, mirroring the entity pipeline's order.
    const ruleAction = desc.ruleAction ?? desc.name;
    const scope = desc.ruleScope?.(req, args) ?? {};
    if (!enforceBusinessRules(req, res, ruleAction, scope)) return;
    try {
      const result = await desc.run(req, res, args);
      recordAudit({
        ts: new Date().toISOString(),
        category: desc.auditCategory ?? "request",
        action,
        actor: actorForAudit(req),
        write: true,
        result: "success",
        ...(desc.auditStatus !== undefined ? { status: desc.auditStatus } : {}),
        ...(desc.auditMeta ? { meta: desc.auditMeta(req, args, result) } : {}),
      });
      if (result !== undefined) res.status(desc.status ?? 200).json(result);
    } catch (err) {
      if (desc.onError) desc.onError(res, err, req, action);
      else throw err;
    }
  };
  const mw = [
    ...(desc.role ? [requireRole(desc.role)] : []),
    ...(desc.gates ?? []),
    handler,
  ];
  router[desc.method](desc.path, ...mw);
}
