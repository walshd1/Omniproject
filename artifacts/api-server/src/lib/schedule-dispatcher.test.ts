import test from "node:test";
import assert from "node:assert/strict";
import { dispatchScheduledRecipes } from "./schedule-dispatcher";
import type { AutomationRecipe } from "@workspace/backend-catalogue";

/**
 * The schedule dispatcher fires each schedule-triggered recipe once per cron-matched minute in the window,
 * claiming each minute exactly once (fleet-safe), and ignores event-triggered / disabled / bad-cron recipes.
 */

const hourly = (id: string, over: Partial<AutomationRecipe> = {}): AutomationRecipe => ({
  id, label: id, scope: { kind: "org" }, trigger: { kind: "schedule", cron: "0 * * * *" }, actions: [{ kind: "notify", params: {} }], ...over,
});

const window2h = [Date.parse("2024-03-01T09:00:00Z"), Date.parse("2024-03-01T11:00:00Z")] as const;

test("fires a schedule recipe once per cron-matched minute in the window", async () => {
  const ran: string[] = [];
  const claimed = new Set<string>();
  const summary = await dispatchScheduledRecipes(window2h[0], window2h[1], [hourly("r1")], {
    claim: async (k) => (claimed.has(k) ? false : (claimed.add(k), true)),
    run: async (r) => { ran.push(r.id); return "ran"; },
  });
  // 10:00 and 11:00 fire (09:00 is the exclusive lower bound).
  assert.deepEqual(summary.fired.map((f) => f.minute), ["2024-03-01T10:00:00.000Z", "2024-03-01T11:00:00.000Z"]);
  assert.deepEqual(ran, ["r1", "r1"]);
});

test("a lost claim (another replica/tick won it) does not run — exactly-once", async () => {
  let runs = 0;
  const summary = await dispatchScheduledRecipes(window2h[0], window2h[1], [hourly("r1")], {
    claim: async () => false, // every minute already claimed elsewhere
    run: async () => { runs++; return "ran"; },
  });
  assert.equal(runs, 0);
  assert.equal(summary.fired.length, 0);
  assert.equal(summary.skippedDedup, 2);
});

test("ignores event-triggered, disabled, and bad-cron recipes", async () => {
  const ran: string[] = [];
  const recipes: AutomationRecipe[] = [
    { id: "evt", label: "evt", scope: { kind: "org" }, trigger: { kind: "issue.created" }, actions: [{ kind: "notify", params: {} }] },
    hourly("disabled", { enabled: false }),
    hourly("badcron", { trigger: { kind: "schedule", cron: "not a cron" } }),
    hourly("good"),
  ];
  await dispatchScheduledRecipes(window2h[0], window2h[1], recipes, {
    claim: async () => true,
    run: async (r) => { ran.push(r.id); return "ran"; },
  });
  assert.deepEqual([...new Set(ran)], ["good"]);
});
