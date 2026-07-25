import { statusClassOf } from "./work-vocabulary";
import { taskStatusClassOf } from "./task-vocabulary";
import type { MethodologyInvariant } from "./methodology-catalogue";

/**
 * METHODOLOGY INVARIANTS — the engine behind a methodology's declarative business rules (see
 * MethodologyInvariant). These are CROSS-ENTITY compliance checks over the whole portfolio, which the
 * write-time ruleset (single-payload, restrict-only) can't express — so they run as a SIGNAL: a report/health
 * surface calls this and shows the breaches, rather than blocking a write (you can't refuse to create a
 * project just because it has no next action YET). PURE: given the portfolio snapshot, it computes the
 * violations. The def carries only the declaration; the meaning lives here, keyed by `kind`.
 *
 * GTD's exemplar — "every active project must have a next action" — reads the leveled vocabularies (a project
 * is in-flight unless its lifecycle class is done/cancelled; a next action is a task whose workflow class is
 * `actionable`), so it stays correct however statuses are relabelled or re-banded.
 */

/** The portfolio snapshot an invariant evaluates against (only the fields the checks read). */
export interface InvariantContext {
  projects: ReadonlyArray<{ id: string; status?: string | null; name?: string | null }>;
  tasks: ReadonlyArray<{ projectId?: string | null; status?: string | null }>;
}

/** One breach of an invariant, tied to the subject entity (a project id, here). */
export interface InvariantViolation {
  invariantId: string;
  kind: string;
  message: string;
  severity: "error" | "warn";
  /** The entity in breach (the project id for the current checks). */
  subjectId: string;
  subjectLabel?: string;
}

/** A project is IN-FLIGHT unless its lifecycle class is done/cancelled (unknown ⇒ open ⇒ in-flight). */
const isProjectInFlight = (status?: string | null): boolean => {
  const c = statusClassOf(status ?? undefined);
  return c === "open" || c === "active";
};

/** A task is a NEXT ACTION when its workflow class is `actionable`. */
const isNextAction = (status?: string | null): boolean => taskStatusClassOf(status ?? undefined) === "actionable";

/** GTD: every in-flight project must have at least one actionable next action. */
function everyActiveProjectHasNextAction(inv: MethodologyInvariant, ctx: InvariantContext): InvariantViolation[] {
  const projectsWithNext = new Set<string>();
  for (const t of ctx.tasks) if (t.projectId && isNextAction(t.status)) projectsWithNext.add(t.projectId);
  const out: InvariantViolation[] = [];
  for (const p of ctx.projects) {
    if (isProjectInFlight(p.status) && !projectsWithNext.has(p.id)) {
      out.push({
        invariantId: inv.id, kind: inv.kind, message: inv.message, severity: inv.severity ?? "warn",
        subjectId: p.id, ...(p.name ? { subjectLabel: p.name } : {}),
      });
    }
  }
  return out;
}

/** kind → checker. A methodology invariant with an UNKNOWN kind contributes nothing (forward-compatible). */
const HANDLERS: Record<string, (inv: MethodologyInvariant, ctx: InvariantContext) => InvariantViolation[]> = {
  "every-active-project-has-next-action": everyActiveProjectHasNextAction,
};

/** The invariant kinds a methodology def may declare (for validation + docs). */
export const METHODOLOGY_INVARIANT_KINDS: readonly string[] = Object.keys(HANDLERS);

/** Evaluate every invariant a methodology declares against the portfolio snapshot, returning all breaches. */
export function evaluateMethodologyInvariants(
  methodology: { invariants?: readonly MethodologyInvariant[] },
  ctx: InvariantContext,
): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const inv of methodology.invariants ?? []) {
    const handler = HANDLERS[inv.kind];
    if (handler) out.push(...handler(inv, ctx));
  }
  return out;
}
