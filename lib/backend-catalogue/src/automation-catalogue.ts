/**
 * AUTOMATION catalogue — the primitives of the user-facing "when X, do Y" recipe builder (Phase 1.2). A
 * recipe is authored as data (trigger + conditions + actions) and COMPILES to the existing workflow-engine
 * JSON; there is no new engine. This catalogue is the single source of the trigger + action types both apps
 * draw from, and — critically — each action declares the PERMISSION it needs, so the hard rule holds: a user
 * may only automate what they may edit.
 *
 * Actions split into:
 *  - `inform` (non-mutating: notify) — runnable directly, scoped to the caller (observe + inform).
 *  - `mutating` (set a field, create work) — NEVER a silent effect; they run only under an autonomous grant
 *    bound to a human responsibility acceptance (the §4.2 path), never widened. Authoring still requires the
 *    author to hold the edit permission for the action.
 */

/** What fires a recipe. */
export type TriggerKind = "schedule" | "issue.created" | "issue.updated";

export interface TriggerDef {
  kind: TriggerKind;
  label: string;
  /** An event trigger carries the changed entity as the run's subject; a schedule carries a cron. */
  mode: "event" | "schedule";
}

export const AUTOMATION_TRIGGERS: TriggerDef[] = [
  { kind: "schedule", label: "On a schedule", mode: "schedule" },
  { kind: "issue.created", label: "When a work item is created", mode: "event" },
  { kind: "issue.updated", label: "When a work item is updated", mode: "event" },
];

/** What an action needs the author to be permitted to do. */
export type ActionRequirement =
  | { kind: "inform" } // sending a notification — no edit permission needed
  | { kind: "project-write" } // writing a work item in the recipe's project scope
  | { kind: "collection"; collection: string }; // editing a named settings collection

export type ActionKind = "notify" | "set-field" | "add-label" | "create-issue";

export interface ActionDef {
  kind: ActionKind;
  label: string;
  /** Mutating actions change state and must run under an autonomous grant, never a silent effect. */
  mutating: boolean;
  requires: ActionRequirement;
  /** The workflow-engine action name this compiles to. */
  effect: string;
}

export const AUTOMATION_ACTIONS: ActionDef[] = [
  { kind: "notify", label: "Send a notification", mutating: false, requires: { kind: "inform" }, effect: "notify" },
  { kind: "set-field", label: "Set a work-item field", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue" },
  { kind: "add-label", label: "Add a label to a work item", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue" },
  { kind: "create-issue", label: "Create a work item", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue" },
];

const actionById = new Map(AUTOMATION_ACTIONS.map((a) => [a.kind, a]));
/** The catalogue definition for an action kind (its permission requirement + compiled effect), or undefined. */
export function getActionDef(kind: string): ActionDef | undefined {
  return actionById.get(kind as ActionKind);
}
const triggerById = new Map(AUTOMATION_TRIGGERS.map((t) => [t.kind, t]));
/** The catalogue definition for a trigger kind (event vs schedule), or undefined. */
export function getTriggerDef(kind: string): TriggerDef | undefined {
  return triggerById.get(kind as TriggerKind);
}

/** A condition test on the triggering entity (same operator set as the report predicate engine). */
export interface AutomationCondition {
  field: string;
  op: "eq" | "ne" | "in" | "gt" | "lt" | "truthy";
  value?: string;
}

/** One action instance in a recipe. */
export interface AutomationAction {
  kind: ActionKind;
  params: Record<string, unknown>;
}

/** A stored automation recipe. */
export interface AutomationRecipe {
  id: string;
  label: string;
  enabled?: boolean;
  /** Org- or project-scoped, like a workflow — a project-scoped recipe can only touch that project. */
  scope: { kind: "org" } | { kind: "project"; projectId: string };
  trigger: { kind: TriggerKind; cron?: string };
  conditions?: AutomationCondition[];
  actions: AutomationAction[];
}

/** Does a recipe mutate state (⇒ needs an autonomous grant to execute)? */
export function recipeMutates(recipe: AutomationRecipe): boolean {
  return recipe.actions.some((a) => getActionDef(a.kind)?.mutating === true);
}
