import { recipeMutates, type AutomationRecipe } from "@workspace/backend-catalogue";
import { readConfigCollection } from "./scoped-config";
import { compileRecipe, matchesConditions } from "./automation";
import { runWorkflow } from "./workflow";
import { effectsForActor, effectsForAutonomousContext, type RunActor } from "./workflow-run";
import { onDomainEvent, domainEventsEnabled, type DomainEvent } from "./domain-event";
import { mintAutonomousContext, registerAutonomousActor } from "./autonomous";
import { AutonomousWriteDenied } from "./autonomous-grant";
import { proposeIfBound } from "./approval-gate";
import { registerApprovalExecutor } from "./approval-service";
import { logger } from "./logger";
import type { Role } from "./rbac";

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

/** The role a rule's autonomous actor runs as. Least privilege — a rule can never mint above this, and a
 *  write still needs an explicit grant on top (default-deny). */
const RULE_ACTOR_ROLE: Role = "contributor";

/** The autonomous actor id a rule's writes run under (`automation:rule_<id>`); the grant is keyed on the
 *  bare id (`rule_<id>`). Underscore, not colon, so `actorIdOf` captures the whole id per-rule. */
export function ruleActorId(recipeId: string): string { return `rule_${recipeId}`; }

/** The approval action a rule's RUN binds to — an admin can gate ONE sensitive rule via an approval chain. */
export function ruleRunAction(recipeId: string): string { return `rule.run:${recipeId}`; }

/**
 * Run a mutating recipe under its own AUTONOMOUS principal. The write reaches the autonomous-guarded broker,
 * so it lands ONLY inside an admin-declared grant for `rule_<id>` (default-deny) — throws
 * {@link AutonomousWriteDenied} otherwise. The target is bound from the triggering subject.
 */
async function runRecipeAutonomously(recipe: AutomationRecipe, subject: Record<string, unknown>): Promise<void> {
  registerAutonomousActor(ruleActorId(recipe.id), RULE_ACTOR_ROLE); // known mint source; the GRANT still gates writes
  const ctx = mintAutonomousContext({ id: ruleActorId(recipe.id), role: RULE_ACTOR_ROLE, reason: `rule ${recipe.id}` }, Date.now());
  await runWorkflow(compileRecipe(recipe, subject), effectsForAutonomousContext(ctx, ctx.sub ?? "automation"));
}

/** Register the approval executor for a rule's run (idempotent) so that, when a bound chain approves, the
 *  rule fires autonomously under the same grant-gated path. */
function ensureRuleExecutor(recipeId: string): void {
  registerApprovalExecutor(ruleRunAction(recipeId), async (params) => {
    const p = (params ?? {}) as { recipeId?: string; subject?: Record<string, unknown> };
    const recipe = readConfigCollection<AutomationRecipe[]>("automations", []).find((r) => r.id === p.recipeId);
    if (!recipe) throw new Error(`rule.run executor: unknown recipe "${p.recipeId}"`);
    await runRecipeAutonomously(recipe, p.subject ?? {});
  });
}

/** What a dispatch did, by recipe id. Returned for observability + to make the logic assertable without
 *  inspecting the notify bus or the broker. */
export interface DispatchResult {
  /** Inform-only recipes that ran, and mutating recipes whose write landed under a grant. */
  ran: string[];
  /** Mutating recipes held for approval (a chain is bound) — a proposal was raised, nothing wrote. */
  deferredApproval: string[];
  /** Mutating recipes denied because the actor has no (matching) autonomous write grant — default-deny. */
  deniedNoGrant: string[];
  /** Recipes whose run threw for another reason. */
  failed: string[];
}

/** Handle one domain event: run every matching, enabled, INFORM-ONLY recipe. Best-effort — each recipe is
 *  isolated so one failure never blocks the rest; mutating recipes are deferred (logged), not run. The
 *  `recipes` source is injectable for tests; production reads the stored automations collection. */
export async function dispatchDomainEvent(
  event: DomainEvent,
  recipes: AutomationRecipe[] = readConfigCollection<AutomationRecipe[]>("automations", []),
): Promise<DispatchResult> {
  const result: DispatchResult = { ran: [], deferredApproval: [], deniedNoGrant: [], failed: [] };
  for (const recipe of recipes) {
    if (recipe.enabled === false) continue;
    if (recipe.trigger.kind !== event.triggerKind) continue;
    if (!scopeMatches(recipe, event)) continue;
    if (!matchesConditions(recipe, event.subject)) continue;

    if (recipeMutates(recipe)) {
      // MUTATING: a dispatched write has no live request, so it runs as an AUTONOMOUS principal —
      // default-deny under the autonomous-grant gate, and held first if an approval chain is bound.
      try {
        ensureRuleExecutor(recipe.id);
        const proposalId = await proposeIfBound(ruleRunAction(recipe.id), { recipeId: recipe.id, subject: event.subject }, event.actor.sub ?? "automation");
        if (proposalId) {
          result.deferredApproval.push(recipe.id);
          logger.info({ recipe: recipe.id, evt: event.id, proposalId }, "rules-dispatcher: mutating recipe held for approval");
          continue;
        }
        await runRecipeAutonomously(recipe, event.subject);
        result.ran.push(recipe.id);
        logger.info({ recipe: recipe.id, evt: event.id, trigger: event.triggerKind }, "rules-dispatcher: mutating recipe ran under grant");
      } catch (err) {
        if (err instanceof AutonomousWriteDenied) {
          result.deniedNoGrant.push(recipe.id);
          logger.info({ recipe: recipe.id, evt: event.id, reason: err.message }, "rules-dispatcher: mutating recipe denied (no autonomous grant)");
        } else {
          result.failed.push(recipe.id);
          logger.warn({ err, recipe: recipe.id, evt: event.id }, "rules-dispatcher: mutating recipe failed");
        }
      }
      continue;
    }

    // INFORM-ONLY: run under the initiating principal (never widened); read + notify only.
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
