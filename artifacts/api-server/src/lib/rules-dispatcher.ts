import { recipeMutates, type AutomationRecipe } from "@workspace/backend-catalogue";
import { readConfigCollection } from "./scoped-config";
import { compileRecipe, matchesConditions } from "./automation";
import { runWorkflow } from "./workflow";
import { effectsForActor, type RunActor } from "./workflow-run";
import { onDomainEvent, domainEventsEnabled, type DomainEvent } from "./domain-event";
import { logger } from "./logger";

/**
 * Rules dispatcher — the "run it" side of the engine. Subscribes to {@link DomainEvent}s and, per event,
 * fires the enabled recipes whose trigger + scope + `when` all match, through the SAME compile→workflow→
 * effect path the manual `POST /automations/:id/run` uses. No new engine.
 *
 * Phase 4 is INFORM-ONLY by construction: a recipe that mutates is SKIPPED here (logged), because an
 * autonomous write must pass the approval + autonomous-grant + containment pipeline — that is the gated-
 * mutation phase, not this one. So the worst a dispatched rule can do today is read + notify. The whole
 * subsystem is off unless RULES_ENGINE_EVENTS is set ({@link domainEventsEnabled}).
 */

/** Does a project/org-scoped recipe apply to this event's scope? Org recipes match everything; a project
 *  recipe matches only its own project. */
function scopeMatches(recipe: AutomationRecipe, event: DomainEvent): boolean {
  if (recipe.scope.kind === "org") return true;
  return !!event.scope.projectId && event.scope.projectId === recipe.scope.projectId;
}

/** The recorded actor a dispatched run executes under — the principal whose write emitted the event. Never
 *  widened: an inform-only run only publishes notifications, so this identity just owns the run + its audit. */
function actorOf(event: DomainEvent): RunActor {
  return { sub: event.actor.sub ?? "automation", ...(event.actor.role ? { role: event.actor.role } : {}) };
}

/** What a dispatch did — recipe ids that ran, were deferred (mutating), or threw. Returned for observability
 *  and to make the selection logic assertable without inspecting the notify bus. */
export interface DispatchResult {
  ran: string[];
  skippedMutating: string[];
  failed: string[];
}

/** Handle one domain event: run every matching, enabled, INFORM-ONLY recipe. Best-effort — each recipe is
 *  isolated so one failure never blocks the rest; mutating recipes are deferred (logged), not run. The
 *  `recipes` source is injectable for tests; production reads the stored automations collection. */
export async function dispatchDomainEvent(
  event: DomainEvent,
  recipes: AutomationRecipe[] = readConfigCollection<AutomationRecipe[]>("automations", []),
): Promise<DispatchResult> {
  const result: DispatchResult = { ran: [], skippedMutating: [], failed: [] };
  for (const recipe of recipes) {
    if (recipe.enabled === false) continue;
    if (recipe.trigger.kind !== event.triggerKind) continue;
    if (!scopeMatches(recipe, event)) continue;
    if (!matchesConditions(recipe, event.subject)) continue;
    if (recipeMutates(recipe)) {
      // Deferred to the gated-mutation phase: an autonomous write needs an approval binding + autonomous
      // grant. Never silently mutate from a dispatched event.
      result.skippedMutating.push(recipe.id);
      logger.info({ recipe: recipe.id, evt: event.id, trigger: event.triggerKind }, "rules-dispatcher: skipping mutating recipe (needs autonomous grant)");
      continue;
    }
    try {
      const owner = event.actor.sub ?? "automation";
      await runWorkflow(compileRecipe(recipe), effectsForActor(actorOf(event), owner));
      result.ran.push(recipe.id);
      logger.info({ recipe: recipe.id, evt: event.id, trigger: event.triggerKind }, "rules-dispatcher: recipe ran");
    } catch (err) {
      result.failed.push(recipe.id);
      logger.warn({ err, recipe: recipe.id, evt: event.id }, "rules-dispatcher: recipe run failed");
    }
  }
  return result;
}

let started = false;

/** Register the dispatcher as a domain-event handler (idempotent). No-op unless the engine is enabled, so
 *  with the flag unset nothing subscribes and the emit side stays a no-op too. Called once from bootstrap. */
export function startRulesDispatcher(): void {
  if (started || !domainEventsEnabled()) return;
  started = true;
  onDomainEvent((event) => { void dispatchDomainEvent(event); });
  logger.info("rules-dispatcher: subscribed to domain events");
}
