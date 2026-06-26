/**
 * Broker conformance suite — broker-agnostic.
 *
 * `runReadConformance` exercises the READ-ONLY half of the broker contract
 * against ANY `Broker` and returns a structured report instead of throwing, so
 * the same suite can run two ways:
 *
 *   - DemoBroker  → the REFERENCE pass (in unit tests; see broker-conformance.test.ts).
 *   - n8n (live)  → the REAL-WORLD pass (the verify-n8n CI step drives the live
 *                   gateway; this runner is safe to point at a live broker because
 *                   it never mutates).
 *
 * Mutating conformance (create/update/delete) is exercised separately and only
 * against DemoBroker, so the suite can never write to a real backend.
 *
 * Keeping the checks here (not inline in the test) means a second broker
 * implementer can import and run them against their adapter to self-certify.
 */
import type { Broker, ActorContext } from "./types";
import { PROVENANCE_VALUES } from "./contract";

export interface ConformanceCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ConformanceResult {
  broker: string;
  ok: boolean;
  checks: ConformanceCheck[];
}

/** Every method the Broker contract requires (optional methods excluded). */
export const REQUIRED_BROKER_METHODS = [
  "listProjects", "createProject", "updateProject", "projectMembers",
  "listIssues", "getIssue", "writeIssue", "listTaskItems", "createTaskItem", "verify",
  "listActivity", "projectSummary", "projectHistory", "baseline", "listRaid", "addRaid",
  "notifications", "portfolioHealth", "resourceCapacity", "projectFinancials",
  "capabilities", "fxRates", "replay",
] as const;

/**
 * Structural conformance: the broker implements the full contract surface.
 * Cheap, never calls a backend — provable for n8n at unit-test time.
 */
export function structuralConformance(b: Broker): ConformanceResult {
  const checks: ConformanceCheck[] = [];
  checks.push({ name: "kind is a string", ok: typeof b.kind === "string" });
  checks.push({ name: "live is a boolean", ok: typeof b.live === "boolean" });
  for (const m of REQUIRED_BROKER_METHODS) {
    checks.push({ name: `implements ${m}()`, ok: typeof (b as unknown as Record<string, unknown>)[m] === "function" });
  }
  return { broker: b.kind, ok: checks.every((c) => c.ok), checks };
}

/**
 * Read-only behavioural conformance — safe against any broker, including live.
 * Returns a report; the caller decides whether a non-ok result is fatal.
 */
export async function runReadConformance(b: Broker, ctx: ActorContext): Promise<ConformanceResult> {
  const checks: ConformanceCheck[] = [];
  const check = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
    try {
      await fn();
      checks.push({ name, ok: true });
    } catch (err) {
      checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };
  const assert = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(msg);
  };

  let pid: string | undefined;

  await check("listProjects returns an array", async () => {
    const projects = await b.listProjects(ctx);
    assert(Array.isArray(projects), "not an array");
    pid = projects[0]?.id;
  });

  await check("verify is a non-mutating dry-run with an actions report", async () => {
    const v = await b.verify(ctx);
    assert(typeof v.ok === "boolean", "ok not boolean");
    assert(Array.isArray(v.actions), "actions not an array");
  });

  await check("listActivity returns an array", async () => assert(Array.isArray(await b.listActivity(ctx)), "not an array"));
  await check("notifications returns an array", async () => assert(Array.isArray(await b.notifications(ctx)), "not an array"));
  await check("portfolioHealth returns an array", async () => assert(Array.isArray(await b.portfolioHealth(ctx)), "not an array"));

  await check("capabilities returns an object", async () => {
    const caps = await b.capabilities(ctx);
    assert(caps && typeof caps === "object", "not an object");
  });

  await check("fxRates returns base + rates", async () => {
    const fx = await b.fxRates(ctx);
    assert(typeof fx.base === "string", "base not a string");
    assert(fx.rates && typeof fx.rates === "object", "rates not an object");
  });

  await check("replay returns states with a valid provenance", async () => {
    const states = await b.replay(ctx, {});
    assert(Array.isArray(states), "not an array");
    if (states.length) {
      assert(typeof states[0]!.at === "string", "state.at not a string");
      assert((PROVENANCE_VALUES as readonly string[]).includes(states[0]!.provenance), "invalid provenance");
    }
  });

  // Project-scoped reads — only when a project is available.
  await check("project-scoped reads (issues/summary/history/raid/capacity/financials/members)", async () => {
    if (!pid) return; // no projects → nothing to scope; not a failure
    const issues = await b.listIssues(ctx, pid);
    assert(Array.isArray(issues), "listIssues not an array");

    if (issues.length) {
      const one = await b.getIssue(ctx, pid, issues[0]!.id);
      assert(one === null || one.id === issues[0]!.id, "getIssue mismatch");
      const items = await b.listTaskItems(ctx, pid, issues[0]!.id);
      assert(Array.isArray(items), "listTaskItems not an array");
    }

    const summary = await b.projectSummary(ctx, pid);
    assert(summary.projectId === pid, "summary projectId mismatch");
    assert(typeof summary.total === "number", "summary.total not a number");

    assert(Array.isArray(await b.projectHistory(ctx, pid)), "projectHistory not an array");
    assert(Array.isArray(await b.listRaid(ctx, pid)), "listRaid not an array");
    assert(Array.isArray(await b.resourceCapacity(ctx, pid)), "resourceCapacity not an array");
    assert(typeof (await b.projectFinancials(ctx, pid)) === "object", "projectFinancials not an object");

    const base = await b.baseline(ctx, pid);
    assert(base === null || Array.isArray(base.items), "baseline.items not an array");

    const members = await b.projectMembers(ctx, pid);
    assert(Array.isArray(members), "projectMembers not an array");
    for (const m of members) assert(m.access === "read" || m.access === "write", "member access invalid");
  });

  return { broker: b.kind, ok: checks.every((c) => c.ok), checks };
}
