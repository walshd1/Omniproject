import type { IRouter, Request, Response, RequestHandler } from "express";
import { requireRole, type Role } from "./rbac";
import { recordAudit, actorForAudit, type AuditCategory } from "./audit";
import { enforceBusinessRules } from "./ruleset-guard";
import { withBrokerErrors } from "../broker";
import { domainEventsEnabled, emitDomainEvent, buildDomainEvent } from "./domain-event";
import type { RuleVerb } from "@workspace/backend-catalogue";

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

export interface CommandDescriptor<A, P = A> {
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
  /** Authorize + validate the request into typed (preliminary) args, or return null having ALREADY sent a
   *  4xx. This step is SYNCHRONOUS — the body/params shape checks that need no I/O. When a command needs to
   *  LOAD something (an entity, a store row) before it can validate scope or ownership, `parse` returns the
   *  preliminary args `P` and {@link CommandDescriptor.prepare} completes them asynchronously. With no
   *  `prepare`, `P` defaults to `A` and `parse` returns the full args directly. */
  parse: (req: Request, res: Response) => P | null;
  /** Optional ASYNC completion after `parse`, before the ruleset. This is where a write whose rule-scope or
   *  precondition depends on a LOOKED-UP value belongs — a task's `projectId` (load the task), a timesheet's
   *  owner/status (read the store) — the sync `parse` can't await, and enforcing such a precondition inside
   *  `run` would wrongly leave a success audit behind (the audit fires only after `run` returns). `prepare`
   *  loads what it needs and returns the completed args `A`, or `null` having ALREADY sent a 4xx/403/409/501.
   *  For a `broker` command it runs INSIDE `withBrokerErrors`, so a broker error thrown while loading maps to
   *  its HTTP status with no audit. Runs after gates + parse, before enforceBusinessRules. */
  prepare?: (req: Request, res: Response, prelim: P) => Promise<A | null>;
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
  /** Declares this command performs broker (southbound) work in `run`. When set, `run` executes inside
   *  `withBrokerErrors`: a thrown broker-taxonomy error is mapped to its HTTP status (409 conflict / 451
   *  residency / 502 unreachable-or-timeout / …) and — crucially — NO success audit is recorded, because the
   *  response is an error, not a success. Pre-broker validation still belongs in `parse` (its 4xx fires before
   *  `run` ever executes). `true` uses a default "<name> failed" log message; the object form customises the
   *  log message and the structured log `ctx`. Mutually exclusive with `onError` (broker errors own the run
   *  phase). Set `status`/`auditStatus` for the success code as usual. */
  broker?: boolean | { message?: string; ctx?: (req: Request, prelim: P) => Record<string, unknown> };
  /** Success status when `run` returns a payload (default 200). */
  status?: number;
  /** Optional domain-event emission for the rules engine. A VERB command is a surface TRANSITION more often
   *  than a noun CRUD (a timesheet `submitted`, a project `closed`), so — unlike the entity pipeline — it
   *  emits only when it OPTS IN here, naming the surface + verb + subject. Fired post-commit, best-effort and
   *  out-of-band (never into the write path); off unless RULES_ENGINE_EVENTS is set. Return null to skip. */
  emits?: (req: Request, args: A, result: unknown) => { surface: string; verb: RuleVerb; subject: Record<string, unknown>; scope?: { projectId?: string; programmeId?: string } } | null;
}

/** The "METHOD /path" this command contributes — for the write-lane ratchet. */
export function commandRoutes<A, P = A>(desc: CommandDescriptor<A, P>): string[] {
  return [`${desc.method.toUpperCase()} ${desc.path}`];
}

/** Mount a command descriptor, running the fixed shell: (role) → parse → [prepare] → ruleset → run → audit
 *  → respond. `parse` is the sync 4xx gate; the optional async `prepare` loads what the ruleset/run need
 *  (an entity, a store row) and can itself send a 4xx — both fire before any success audit. */
export function mountCommand<A, P = A>(router: IRouter, desc: CommandDescriptor<A, P>): void {
  const handler = async (req: Request, res: Response): Promise<void> => {
    const prelim = desc.parse(req, res);
    if (prelim === null) return;
    // Best-available action label for the onError path, refined once args are finalised (post-prepare).
    let action = desc.name;
    // The guarded core: finalise args (async prepare) → ruleset → run → success-audit + respond. For a
    // broker command this whole core runs inside withBrokerErrors, so a broker error thrown while LOADING
    // (in prepare) or WRITING (in run) maps to its HTTP status and the success audit never fires.
    const core = async (): Promise<void> => {
      let args: A;
      if (desc.prepare) {
        const prepared = await desc.prepare(req, res, prelim);
        if (prepared === null) return; // prepare already sent a 4xx/403/409/501
        args = prepared;
      } else {
        // No prepare ⇒ P === A, and `parse` already returned the full args.
        args = prelim as unknown as A;
      }
      action = typeof desc.audit === "function" ? desc.audit(args) : desc.audit;
      // Every command checks the business ruleset by construction — `ruleAction` when given, else the command
      // name. Non-applicable rules are ignored, so this is a no-op under default config; when a write-wide
      // rule (a `read-only` freeze, an `any-write` field rule) is active it now covers verb writes too, not
      // just entity writes. Runs after parse/prepare and before run, mirroring the entity pipeline's order.
      const ruleAction = desc.ruleAction ?? desc.name;
      const scope = desc.ruleScope?.(req, args) ?? {};
      if (!enforceBusinessRules(req, res, ruleAction, scope)) return;
      // On SUCCESS only: record the audit then send the payload. Not reached when `run`/`prepare` throws — so
      // a broker error (below) or a mapped `onError` never leaves a spurious success audit behind.
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
      // Post-commit domain event (opt-in): a verb that represents a surface transition fires the rules
      // engine. Best-effort + out-of-band (domain-event.ts); off unless RULES_ENGINE_EVENTS is set.
      if (desc.emits && domainEventsEnabled()) {
        const e = desc.emits(req, args, result);
        if (e) emitDomainEvent(buildDomainEvent(req, e.surface, e.verb, e.subject, e.scope ?? {}));
      }
    };
    if (desc.broker) {
      // Broker-aware: run the core inside withBrokerErrors, so a thrown broker-taxonomy error maps to its
      // HTTP status and the success audit never runs. Mirrors the entity pipeline's wrapper.
      const b = desc.broker === true ? {} : desc.broker;
      await withBrokerErrors(req, res, b.message ?? `${desc.name} failed`, core, b.ctx?.(req, prelim) ?? {});
    } else {
      try {
        await core();
      } catch (err) {
        if (desc.onError) desc.onError(res, err, req, action);
        else throw err;
      }
    }
  };
  const mw = [
    ...(desc.role ? [requireRole(desc.role)] : []),
    ...(desc.gates ?? []),
    handler,
  ];
  router[desc.method](desc.path, ...mw);
}
