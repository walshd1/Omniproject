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
import type { ConditionSet } from "./predicate";

/**
 * A SURFACE the rules engine can watch (and, later, act on) — the noun behind a trigger/action. This is the
 * surface-agnostic core: a new surface is a DATA entry here, never an engine change. The event triggers are
 * GENERATED from `surfaces × verbs`, so "what can fire a rule" is declared in one place and can't drift from
 * the emit side, which publishes the same `<key>.<verb>` kind strings.
 */
export interface RuleSurface {
  /** The noun key — also the emitted event's `surface` and the `<key>.<verb>` trigger prefix. */
  key: string;
  /** Human label (singular), e.g. "Work item", "Task", "Risk". */
  label: string;
  /** The lifecycle verbs that emit an event for this surface (each becomes a `<key>.<verb>` trigger). */
  verbs: RuleVerb[];
  /**
   * The workflow-engine effect a MUTATING action on this surface compiles to (wired in the gated-mutation
   * phase). Absent ⇒ the surface is observe/notify-only for now (its triggers fire; no mutating action yet).
   */
  writeEffect?: string;
  /** Field keys the event subject is guaranteed to carry — drives the IF/target pickers in the builder. */
  subjectFields?: string[];
}

/** The lifecycle verbs a surface can emit. `updated` is the catch-all; the others are specific transitions. */
export type RuleVerb = "created" | "updated" | "status-changed" | "deleted" | "closed" | "submitted";

/** How each verb reads in a trigger label: "When a work item <phrase>". */
const VERB_PHRASE: Record<RuleVerb, string> = {
  created: "is created",
  updated: "is updated",
  "status-changed": "changes status",
  deleted: "is deleted",
  closed: "is closed",
  submitted: "is submitted",
};

/**
 * The surfaces the rules engine understands — DATA, not code. `issue` keeps its historical `writeEffect`
 * (the only broker write wired today); the rest are observe/notify-only until the gated-mutation phase adds
 * their write effects. Adding a surface (or a verb) here extends the trigger catalogue with no engine change.
 */
export const RULE_SURFACES: RuleSurface[] = [
  { key: "issue", label: "Work item", verbs: ["created", "updated", "status-changed", "deleted"], writeEffect: "broker.writeIssue", subjectFields: ["id", "projectId", "status", "priority", "type", "assignee", "title"] },
  { key: "task", label: "Task", verbs: ["created", "updated", "status-changed", "deleted"], subjectFields: ["id", "projectId", "status", "assignee", "title"] },
  { key: "risk", label: "Risk", verbs: ["created", "updated"], subjectFields: ["id", "projectId", "severity", "likelihood", "status"] },
  { key: "project", label: "Project", verbs: ["created", "updated", "closed"], subjectFields: ["id", "projectType", "programmeId", "status"] },
  { key: "timesheet", label: "Timesheet", verbs: ["created", "updated", "submitted"], subjectFields: ["id", "projectId", "status", "userId"] },
  { key: "wiki-doc", label: "Wiki document", verbs: ["created", "updated", "deleted"], subjectFields: ["id", "projectId", "title"] },
];

const surfaceByKey = new Map(RULE_SURFACES.map((s) => [s.key, s]));
/** The surface definition for a key (e.g. "task"), or undefined. */
export function getRuleSurface(key: string): RuleSurface | undefined {
  return surfaceByKey.get(key);
}

/**
 * What fires a recipe — a `<surface>.<verb>` event kind (e.g. "task.status-changed") or "schedule". A string,
 * not a closed union, because the set is DATA-driven (extends with {@link RULE_SURFACES}).
 */
export type TriggerKind = string;

export interface TriggerDef {
  kind: TriggerKind;
  label: string;
  /** An event trigger carries the changed entity as the run's subject; a schedule carries a cron. */
  mode: "event" | "schedule";
  /** For event triggers: the noun + verb this fires on (absent for schedule). */
  surface?: string;
  verb?: RuleVerb;
  /** The subject fields this trigger's event is guaranteed to carry (for the IF picker). */
  subjectFields?: string[];
}

/**
 * The trigger catalogue: the schedule trigger + one GENERATED event trigger per `surface × verb`. The
 * historical `issue.created` / `issue.updated` kinds fall out of the `issue` surface unchanged, so stored
 * recipes keep resolving.
 */
export const AUTOMATION_TRIGGERS: TriggerDef[] = [
  { kind: "schedule", label: "On a schedule", mode: "schedule" },
  ...RULE_SURFACES.flatMap((s) =>
    s.verbs.map((v): TriggerDef => ({
      kind: `${s.key}.${v}`,
      label: `When a ${s.label.toLowerCase()} ${VERB_PHRASE[v]}`,
      mode: "event",
      surface: s.key,
      verb: v,
      subjectFields: s.subjectFields ?? [],
    })),
  ),
];

/** What an action needs the author to be permitted to do. */
export type ActionRequirement =
  | { kind: "inform" } // sending a notification — no edit permission needed
  | { kind: "project-write" } // writing a work item in the recipe's project scope
  | { kind: "collection"; collection: string }; // editing a named settings collection

/** An action kind — a string, since the mutating field-write actions are surface-parameterised (data-driven). */
export type ActionKind = string;

export interface ActionDef {
  kind: ActionKind;
  label: string;
  /** Mutating actions change state and must run under an autonomous grant, never a silent effect. */
  mutating: boolean;
  requires: ActionRequirement;
  /** The workflow-engine action name this compiles to. */
  effect: string;
  /**
   * The noun this action targets (absent for `notify`, which is surface-agnostic). The concrete write
   * effect comes from the surface's `writeEffect`; today only `issue` has one wired, so non-issue mutating
   * actions are catalogued (authored + validated) but only run once the gated-mutation phase wires effects.
   */
  surface?: string;
}

export const AUTOMATION_ACTIONS: ActionDef[] = [
  { kind: "notify", label: "Send a notification", mutating: false, requires: { kind: "inform" }, effect: "notify" },
  { kind: "set-field", label: "Set a field", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue", surface: "issue" },
  { kind: "add-label", label: "Add a label", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue", surface: "issue" },
  { kind: "set-status", label: "Set the status", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue", surface: "issue" },
  { kind: "assign", label: "Assign to a person", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue", surface: "issue" },
  { kind: "create-issue", label: "Create a work item", mutating: true, requires: { kind: "project-write" }, effect: "broker.writeIssue", surface: "issue" },
  // Finance — an ORG-level posting action (not a project work-item write): run the fixed-asset depreciation
  // period-run. Its effect (`finance.runDepreciation`) reads the register + posts balanced GL journals through
  // the grant-gated command edge, so like every mutating action it runs only under an autonomous grant.
  { kind: "run-depreciation", label: "Post fixed-asset depreciation", mutating: true, requires: { kind: "collection", collection: "accounting" }, effect: "finance.runDepreciation" },
];

const actionById = new Map(AUTOMATION_ACTIONS.map((a) => [a.kind, a]));
/** The catalogue definition for an action kind (its permission requirement + compiled effect), or undefined. */
export function getActionDef(kind: string): ActionDef | undefined {
  return actionById.get(kind);
}
const triggerById = new Map(AUTOMATION_TRIGGERS.map((t) => [t.kind, t]));
/** The catalogue definition for a trigger kind (event vs schedule), or undefined. */
export function getTriggerDef(kind: string): TriggerDef | undefined {
  return triggerById.get(kind as TriggerKind);
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
  /** The IF — a {@link ConditionSet} (`all`/`any` nesting over the full predicate operator set) evaluated
   *  against the triggering entity by the shared predicate engine. Absent ⇒ the rule fires unconditionally. */
  when?: ConditionSet;
  actions: AutomationAction[];
}

/** Does a recipe mutate state (⇒ needs an autonomous grant to execute)? */
export function recipeMutates(recipe: AutomationRecipe): boolean {
  return recipe.actions.some((a) => getActionDef(a.kind)?.mutating === true);
}
