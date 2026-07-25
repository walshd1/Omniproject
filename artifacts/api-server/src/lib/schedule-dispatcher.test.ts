import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recipeScheduledJobs } from "./schedule-dispatcher";
import { runDueScheduledJobs } from "./job-scheduler";
import type { AutomationRecipe } from "@workspace/backend-catalogue";

/**
 * The schedule provider turns each enabled, valid-cron, schedule-triggered recipe into a cron ScheduledJob for
 * the unified engine (gated by the rules-engine flag), and the engine fires each cron minute exactly once.
 */

const prev = process.env["RULES_ENGINE_EVENTS"];
afterEach(() => { if (prev === undefined) delete process.env["RULES_ENGINE_EVENTS"]; else process.env["RULES_ENGINE_EVENTS"] = prev; });

const hourly = (id: string, over: Partial<AutomationRecipe> = {}): AutomationRecipe => ({
  id, label: id, scope: { kind: "org" }, trigger: { kind: "schedule", cron: "0 * * * *" }, actions: [{ kind: "notify", params: {} }], ...over,
});

test("yields nothing when the rules engine is off (RULES_ENGINE_EVENTS unset)", () => {
  delete process.env["RULES_ENGINE_EVENTS"];
  assert.deepEqual(recipeScheduledJobs([hourly("r1")]), []);
});

test("maps each enabled schedule-recipe to a cron job; ignores event-triggered / disabled / bad-cron", () => {
  process.env["RULES_ENGINE_EVENTS"] = "1";
  const recipes: AutomationRecipe[] = [
    { id: "evt", label: "evt", scope: { kind: "org" }, trigger: { kind: "issue.created" }, actions: [{ kind: "notify", params: {} }] },
    hourly("disabled", { enabled: false }),
    hourly("badcron", { trigger: { kind: "schedule", cron: "not a cron" } }),
    hourly("good"),
  ];
  const jobs = recipeScheduledJobs(recipes);
  assert.deepEqual(jobs.map((j) => j.id), ["recipe:good"]);
  assert.deepEqual(jobs[0]!.resolveSchedule(), { kind: "cron", expr: "0 * * * *" });
});

test("through the engine: fires each cron-matched minute once, claim-once (exactly-once fleet-wide)", async () => {
  process.env["RULES_ENGINE_EVENTS"] = "1";
  // Stub each job's run so the test exercises the provider's cron mapping + the engine's claim-once, without
  // driving the real grant-gated below-seam recipe run.
  const ran: string[] = [];
  const jobs = recipeScheduledJobs([hourly("r1")]).map((j) => ({ ...j, run: async (ms: number) => { ran.push(new Date(ms).toISOString()); } }));
  const claimed = new Set<string>();
  const tick = () => runDueScheduledJobs(
    Date.parse("2024-03-01T09:00:00Z"), Date.parse("2024-03-01T11:00:00Z"),
    { jobs, claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)) },
  );

  const summary = await tick();
  // 10:00 and 11:00 fire (09:00 is the exclusive lower bound); claim keys are namespaced by the recipe job id.
  assert.deepEqual(ran, ["2024-03-01T10:00:00.000Z", "2024-03-01T11:00:00.000Z"]);
  assert.equal(summary.fired.length, 2);
  assert.ok([...claimed].every((k) => k.startsWith("job:recipe:r1:")));

  // A second identical tick re-claims nothing — no double-fire.
  const again = await tick();
  assert.equal(again.fired.length, 0);
  assert.equal(again.skippedDedup, 2);
});
