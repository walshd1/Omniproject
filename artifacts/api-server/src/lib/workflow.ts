/**
 * Workflow ENGINE — the bounded, deterministic interpreter for admin/PMO/PM-authored workflows (design
 * §5). A workflow is a tree of STEPS: run an action, branch on a prior result, or loop over a prior
 * result's array. The genuinely-new part is the branch/loop/sequence control flow; what a step DOES
 * (call the broker, notify, build a report, gate on an approval chain) is an injected EFFECT, so this
 * module is pure — no broker, no I/O — and fully unit-testable, and every effect stays behind the seam
 * the caller controls (RBAC-scoped there, never widened here).
 *
 * Hard bounds (the autonomous-guard posture): a step budget and a nesting-depth cap, so a malformed or
 * adversarial workflow can't spin or blow the stack. Definitions are validated (validateWorkflow) before
 * they run, and are stored as JSON (params only, never code) in project/org config.
 */
import { envInt } from "./env-config";
import { isForbiddenKey } from "./safe-json";

export class WorkflowError extends Error {
  constructor(message: string) { super(message); this.name = "WorkflowError"; }
}

/** A test over the run context — used by a `condition` step to branch. */
export interface StepTest {
  /** The step id whose result is examined. */
  result: string;
  /** Passes when that result is deep-equal to `equals` (when given). */
  equals?: unknown;
  /** Passes when the result exists / is non-empty (when `true`) or is absent (when `false`). */
  exists?: boolean;
}

export interface WorkflowStep {
  id: string;
  kind: "action" | "condition" | "loop";
  // kind: "action" — run an injected effect; its return is stored under this step's id.
  action?: string;
  params?: Record<string, unknown>;
  // kind: "condition" — run `then` when `test` passes, else `else`.
  test?: StepTest;
  then?: WorkflowStep[];
  else?: WorkflowStep[];
  // kind: "loop" — iterate `body` once per element of a prior step's array result, binding it as `item`.
  over?: string;
  body?: WorkflowStep[];
}

export interface WorkflowDef {
  id: string;
  scope: { kind: "org" } | { kind: "project"; projectId: string };
  steps: WorkflowStep[];
}

/** The mutable run state threaded through a workflow. `results` holds each action step's return; `vars`
 *  holds the current loop bindings (e.g. `item`). Effects READ it (never widen scope from it). */
export interface WorkflowRunContext {
  results: Record<string, unknown>;
  vars: Record<string, unknown>;
}

/** The injected effect surface — the ONLY way a step touches the outside world. The caller wires this to
 *  the (RBAC-scoped) broker/notify/report/approval surfaces below the seam. */
export type WorkflowEffect = (action: string, params: Record<string, unknown>, ctx: WorkflowRunContext) => Promise<unknown>;

// Runaway/stack guards. Admin-tunable for large enterprise orchestrations (the interpreter stays pure —
// these are read once at load, exactly like every other envInt-backed bound). Defaults unchanged.
const MAX_STEPS = envInt("WORKFLOW_MAX_STEPS", 1000, { min: 1 }); // step budget (autonomous-guard posture)
const MAX_DEPTH = envInt("WORKFLOW_MAX_DEPTH", 24, { min: 1 });   // nesting-depth cap (adversarial nesting)

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function evalTest(test: StepTest, ctx: WorkflowRunContext): boolean {
  const value = ctx.results[test.result];
  if ("equals" in test) return JSON.stringify(value ?? null) === JSON.stringify(test.equals ?? null);
  if (typeof test.exists === "boolean") return test.exists ? !isEmpty(value) : isEmpty(value);
  return !isEmpty(value); // default: truthy/non-empty
}

async function runSteps(steps: readonly WorkflowStep[], ctx: WorkflowRunContext, effect: WorkflowEffect, budget: { n: number }, depth: number): Promise<void> {
  if (depth > MAX_DEPTH) throw new WorkflowError("workflow nested too deep");
  for (const step of steps) {
    if (++budget.n > MAX_STEPS) throw new WorkflowError("workflow step budget exceeded");
    switch (step.kind) {
      case "action":
        ctx.results[step.id] = await effect(step.action ?? "", step.params ?? {}, ctx);
        break;
      case "condition":
        await runSteps(evalTest(step.test ?? { result: "" }, ctx) ? (step.then ?? []) : (step.else ?? []), ctx, effect, budget, depth + 1);
        break;
      case "loop": {
        const over = ctx.results[step.over ?? ""];
        if (!Array.isArray(over)) break; // nothing to iterate — a non-array (or missing) result is a no-op
        for (const item of over) {
          if (++budget.n > MAX_STEPS) throw new WorkflowError("workflow step budget exceeded");
          const saved = ctx.vars;
          ctx.vars = { ...saved, item };
          await runSteps(step.body ?? [], ctx, effect, budget, depth + 1);
          ctx.vars = saved; // pop the loop binding
        }
        break;
      }
    }
  }
}

/** Run a validated workflow against an injected effect surface. Returns the final run context (each action
 *  step's result). Deterministic given the effect; bounded by the step + depth caps. */
export async function runWorkflow(def: WorkflowDef, effect: WorkflowEffect): Promise<WorkflowRunContext> {
  // `results` is keyed by step ids, `vars` by loop-var names. A reserved key can't reach here —
  // validateWorkflow rejects a reserved step id at the input choke point (see isForbiddenKey there).
  const ctx: WorkflowRunContext = { results: {}, vars: {} };
  await runSteps(def.steps, ctx, effect, { n: 0 }, 0);
  return ctx;
}

// ── Validation (workflows are stored as JSON) ────────────────────────────────
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function validateSteps(raw: unknown, ids: Set<string>, depth: number): WorkflowStep[] {
  if (depth > MAX_DEPTH) throw new WorkflowError("workflow nested too deep");
  if (!Array.isArray(raw)) throw new WorkflowError("steps must be an array");
  return raw.map((sr) => {
    const s = (sr ?? {}) as Record<string, unknown>;
    const id = str(s["id"]);
    if (!id) throw new WorkflowError("each step needs an id");
    // A step id is used as an object key (`ctx.results[step.id] = …`); reject reserved names so a stored
    // workflow can't reparent the run context. The id is a JSON VALUE, so the express.json reviver never
    // strips it — this is the choke point that must.
    if (isForbiddenKey(id)) throw new WorkflowError(`step id "${id}" is not allowed`);
    if (ids.has(id)) throw new WorkflowError(`duplicate step id "${id}"`);
    ids.add(id);
    const kind = s["kind"];
    if (kind === "action") {
      if (!str(s["action"])) throw new WorkflowError(`action step "${id}" needs an action`);
      return { id, kind, action: str(s["action"]), ...(s["params"] && typeof s["params"] === "object" ? { params: s["params"] as Record<string, unknown> } : {}) };
    }
    if (kind === "condition") {
      const t = (s["test"] ?? {}) as Record<string, unknown>;
      if (!str(t["result"])) throw new WorkflowError(`condition step "${id}" needs test.result`);
      const test: StepTest = { result: str(t["result"]), ...("equals" in t ? { equals: t["equals"] } : {}), ...(typeof t["exists"] === "boolean" ? { exists: t["exists"] } : {}) };
      return { id, kind, test, then: validateSteps(s["then"] ?? [], ids, depth + 1), ...(s["else"] ? { else: validateSteps(s["else"], ids, depth + 1) } : {}) };
    }
    if (kind === "loop") {
      if (!str(s["over"])) throw new WorkflowError(`loop step "${id}" needs an 'over' result key`);
      return { id, kind, over: str(s["over"]), body: validateSteps(s["body"] ?? [], ids, depth + 1) };
    }
    throw new WorkflowError(`step "${id}" has an unknown kind "${String(kind)}"`);
  });
}

/** Validate + normalise a LIST of workflow definitions (the settings shape) — unique workflow ids. */
export function validateWorkflows(value: unknown): WorkflowDef[] {
  if (!Array.isArray(value)) throw new WorkflowError("workflows must be an array");
  const ids = new Set<string>();
  return value.map((w) => {
    const def = validateWorkflow(w);
    if (ids.has(def.id)) throw new WorkflowError(`duplicate workflow id "${def.id}"`);
    ids.add(def.id);
    return def;
  });
}

/** Validate + normalise a workflow definition (throws {@link WorkflowError}). Enforces globally-unique step
 *  ids, known step kinds, required fields per kind, and the depth cap. */
export function validateWorkflow(value: unknown): WorkflowDef {
  const v = (value ?? {}) as Record<string, unknown>;
  const id = str(v["id"]);
  if (!id) throw new WorkflowError("a workflow needs an id");
  const scopeRaw = (v["scope"] ?? {}) as Record<string, unknown>;
  let scope: WorkflowDef["scope"];
  if (scopeRaw["kind"] === "org") scope = { kind: "org" };
  else if (scopeRaw["kind"] === "project" && str(scopeRaw["projectId"])) scope = { kind: "project", projectId: str(scopeRaw["projectId"]) };
  else throw new WorkflowError(`workflow "${id}" scope must be {kind:'org'} or {kind:'project',projectId}`);
  return { id, scope, steps: validateSteps(v["steps"] ?? [], new Set<string>(), 0) };
}
