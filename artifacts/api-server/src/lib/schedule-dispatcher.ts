import { getTriggerDef, type AutomationRecipe } from "@workspace/backend-catalogue";
import { readConfigCollection } from "./scoped-config";
import { cronMinutesInWindow, isValidCron } from "./cron-match";
import { runScheduledRecipe, type RecipeRunOutcome } from "./rules-dispatcher";
import { domainEventsEnabled } from "./domain-event";
import { createIntervalScheduler } from "./scheduled-job";
import { sharedKv } from "./shared-state";
import { logger } from "./logger";

/**
 * SCHEDULE DISPATCHER — the time-driven half of the rules engine, the counterpart to the event-driven
 * rules-dispatcher. It activates the automation catalogue's `schedule` trigger (previously authorable but
 * dormant): on each tick it fires every enabled schedule-triggered recipe whose cron matched a minute in the
 * window since the last tick, through the SAME grant-gated run path (`runScheduledRecipe`). No new run engine —
 * only the "when" is new.
 *
 * Fleet-safe: each matched minute is CLAIMED once (compare-and-set on the shared KV) before running, so
 * overlapping ticks or multiple replicas fire each occurrence exactly once. Off by default (opt-in timer, and
 * gated by the rules engine flag) — for a fleet, set the interval to 0 on all but one replica, or 0 everywhere
 * and drive {@link dispatchScheduledRecipes} from an external cron.
 */

export interface ScheduleDispatchSummary {
  /** Each (recipe, minute) that won its claim and ran, with the run outcome. */
  fired: { recipeId: string; minute: string; outcome: RecipeRunOutcome }[];
  /** Occurrences skipped because another tick/replica already claimed that minute. */
  skippedDedup: number;
}

export interface ScheduleDispatchDeps {
  /** Win-once claim for a (recipe, minute) key — default the shared-KV compare-and-set (fleet-safe). */
  claim?: (key: string) => Promise<boolean>;
  /** Run one recipe — default {@link runScheduledRecipe}. Injectable for tests. */
  run?: (recipe: AutomationRecipe) => Promise<RecipeRunOutcome>;
}

/** A claimed minute stays claimed well past any realistic tick window, so a slow/overlapping tick can't re-fire it. */
const SCHED_TTL_MS = 36 * 60 * 60 * 1000;

/**
 * Fire every enabled schedule-triggered recipe whose cron matched a minute in `(sinceMs, nowMs]`. Each matched
 * minute is claimed once before running (exactly-once fleet-wide). Never throws — a per-recipe/claim failure is
 * isolated so one bad recipe can't block the rest. Returns a summary for observability + assertions.
 */
export async function dispatchScheduledRecipes(
  sinceMs: number,
  nowMs: number,
  recipes: AutomationRecipe[] = readConfigCollection<AutomationRecipe[]>("automations", []),
  deps: ScheduleDispatchDeps = {},
): Promise<ScheduleDispatchSummary> {
  const claim = deps.claim ?? ((key: string) => sharedKv.cas(key, null, "1", { ttlMs: SCHED_TTL_MS }));
  const run = deps.run ?? runScheduledRecipe;
  const summary: ScheduleDispatchSummary = { fired: [], skippedDedup: 0 };

  for (const recipe of recipes) {
    if (recipe.enabled === false) continue;
    const tDef = getTriggerDef(recipe.trigger.kind);
    if (!tDef || tDef.mode !== "schedule") continue;
    const cron = recipe.trigger.cron;
    if (!cron || !isValidCron(cron)) continue;

    let minutes: Date[];
    try { minutes = cronMinutesInWindow(cron, sinceMs, nowMs); } catch { continue; }
    for (const minute of minutes) {
      const key = `sched:${recipe.id}:${minute.toISOString()}`;
      let won = false;
      try { won = await claim(key); } catch { won = false; } // a claim outage must NOT double-fire — treat as lost
      if (!won) { summary.skippedDedup++; continue; }
      const outcome = await run(recipe);
      summary.fired.push({ recipeId: recipe.id, minute: minute.toISOString(), outcome });
    }
  }
  return summary;
}

let lastRunMs = 0;
const scheduler = createIntervalScheduler("SCHEDULE_DISPATCH_INTERVAL_HOURS", 0, "schedule-dispatcher");

/**
 * Start the schedule dispatcher's opt-in in-process timer. No-op unless the rules engine is enabled AND
 * `SCHEDULE_DISPATCH_INTERVAL_HOURS` > 0. Each tick fires the recipes due since the previous tick. Called once at
 * boot (after the event dispatcher).
 */
export function startScheduleDispatcher(): void {
  if (!domainEventsEnabled()) return; // the rules engine gates the whole subsystem
  lastRunMs = Date.now();
  scheduler.start(async () => {
    const now = Date.now();
    const since = lastRunMs;
    lastRunMs = now;
    const summary = await dispatchScheduledRecipes(since, now);
    if (summary.fired.length) logger.info({ fired: summary.fired.length }, "schedule-dispatcher: fired scheduled recipes");
  });
}

/** Stop the dispatcher's timer (tests / shutdown). */
export function stopScheduleDispatcher(): void { scheduler.stop(); }
