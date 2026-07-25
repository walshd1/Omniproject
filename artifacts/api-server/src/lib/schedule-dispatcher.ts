import { getTriggerDef, type AutomationRecipe } from "@workspace/backend-catalogue";
import { readConfigCollection } from "./scoped-config";
import { isValidCron } from "./cron-match";
import { runScheduledRecipe } from "./rules-dispatcher";
import { domainEventsEnabled } from "./domain-event";
import type { ScheduledJob } from "./job-scheduler";

/**
 * SCHEDULE PROVIDER — the time-driven half of the rules engine, expressed as jobs for the unified
 * {@link job-scheduler}. It activates the automation catalogue's `schedule` trigger (authorable but otherwise
 * dormant): every enabled schedule-triggered recipe with a valid cron becomes a cron {@link ScheduledJob}, run
 * through the SAME grant-gated path (`runScheduledRecipe`). No dispatcher of its own — the shared heartbeat
 * walks these jobs alongside the infra jobs, and the engine's claim-once makes each occurrence fire exactly
 * once fleet-wide.
 *
 * Gated by the rules-engine flag ({@link domainEventsEnabled}): when it's off the provider yields nothing, so
 * no scheduled recipe runs. Re-read fresh each tick, so a newly authored/enabled recipe is picked up without a
 * restart.
 */
export function recipeScheduledJobs(
  recipes: AutomationRecipe[] = readConfigCollection<AutomationRecipe[]>("automations", []),
): ScheduledJob[] {
  if (!domainEventsEnabled()) return []; // the rules engine gates the whole subsystem
  const jobs: ScheduledJob[] = [];
  for (const recipe of recipes) {
    if (recipe.enabled === false) continue;
    const tDef = getTriggerDef(recipe.trigger.kind);
    if (!tDef || tDef.mode !== "schedule") continue;
    const cron = recipe.trigger.cron;
    if (!cron || !isValidCron(cron)) continue;
    jobs.push({
      id: `recipe:${recipe.id}`,
      label: `automation recipe "${recipe.label}"`,
      resolveSchedule: () => ({ kind: "cron", expr: cron }),
      run: () => runScheduledRecipe(recipe),
    });
  }
  return jobs;
}
