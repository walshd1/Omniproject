import { METHODOLOGIES } from "./methodology-catalogue";

/**
 * REFERENCE RULESETS — a curated, named business-ruleset bundle per methodology,
 * to help a PMO get compliance + completeness right out of the box.
 *
 * These are *data*, not code: each bundle is just a set of built-in rule MODES
 * plus FIELD rules, expressed in the same neutral shape the business-ruleset
 * engine consumes (`lib/ruleset.ts`). Applying a bundle therefore inherits every
 * safety guarantee of the engine — it is **restrict-only** (a bundle can only set
 * a rule to hard/warn/off and require a field; it can never grant, escalate, or
 * loosen a hard gate). A PMO reviews and applies one; nothing here runs on its own.
 *
 * The modes map only lists rules a methodology actively wants ON — applying a
 * bundle sets every other built-in to "off", so "apply Scrum" is deterministic.
 *
 * They are *reference* mappings: sensible defaults to confirm + tune, not law.
 */

export type RuleMode = "hard" | "warn" | "off";

/** A field-presence rule (mirrors the engine's FieldRule, kept neutral here). */
export interface ReferenceFieldRule {
  id: string;
  /** Exact action ("create_issue" | "update_issue" | …) or "any-write". */
  action: string;
  /** Canonical field that must be present + non-empty. */
  field: string;
  /** Dependency: only required when THIS field is present. */
  whenPresent?: string;
  mode: RuleMode;
  message?: string;
}

export interface ReferenceRuleset {
  /** The methodology id this bundle belongs to (matches the methodology plane). */
  methodology: string;
  label: string;
  /** Why these rules aid this methodology's compliance + completeness. */
  rationale: string;
  /** Built-in rule modes to set ON (every unlisted built-in applies as "off"). */
  modes: Record<string, RuleMode>;
  /** The field rules to load. */
  fieldRules: ReferenceFieldRule[];
}

// Common building blocks — keep schedule sanity hard across the board (a due date
// before a start date is never intended), the rest tuned per methodology.
const SCHEDULE_SANITY: Record<string, RuleMode> = { "due-after-start": "hard" };

export const REFERENCE_RULESETS: Record<string, ReferenceRuleset> = {
  scrum: {
    methodology: "scrum",
    label: "Scrum compliance baseline",
    rationale:
      "Stories should be owned and estimated so the sprint is plannable; schedule sanity stays hard.",
    modes: { ...SCHEDULE_SANITY, "require-assignee": "warn", "require-description": "warn" },
    fieldRules: [
      { id: "scrum-estimate", action: "create_issue", field: "storyPoints", mode: "warn", message: "Stories should carry a story-point estimate (Scrum)." },
    ],
  },
  kanban: {
    methodology: "kanban",
    label: "Kanban flow baseline",
    rationale:
      "Pulled work should be owned, and a blocked card must say why so the flow is visible. No estimation is imposed.",
    modes: { ...SCHEDULE_SANITY, "require-assignee": "warn" },
    fieldRules: [
      { id: "kanban-blocked-reason", action: "any-write", field: "blockedReason", whenPresent: "blocked", mode: "warn", message: "A blocked card must record why it is blocked (Kanban flow)." },
    ],
  },
  scrumban: {
    methodology: "scrumban",
    label: "Scrumban baseline",
    rationale:
      "Scrum's estimation discipline plus Kanban's blocked-work visibility.",
    modes: { ...SCHEDULE_SANITY, "require-assignee": "warn" },
    fieldRules: [
      { id: "scrumban-estimate", action: "create_issue", field: "storyPoints", mode: "warn", message: "Stories should carry a story-point estimate (Scrumban)." },
      { id: "scrumban-blocked-reason", action: "any-write", field: "blockedReason", whenPresent: "blocked", mode: "warn", message: "A blocked card must record why it is blocked (Scrumban)." },
    ],
  },
  waterfall: {
    methodology: "waterfall",
    label: "Waterfall plan-completeness baseline",
    rationale:
      "Plan-driven work needs dated, estimated, described tasks to baseline and track a critical path.",
    modes: { ...SCHEDULE_SANITY, "require-description": "warn" },
    fieldRules: [
      { id: "waterfall-start", action: "create_issue", field: "startDate", mode: "hard", message: "A start date is required to baseline a plan-driven task (Waterfall)." },
      { id: "waterfall-due", action: "create_issue", field: "dueDate", mode: "hard", message: "A finish date is required to baseline a plan-driven task (Waterfall)." },
      { id: "waterfall-estimate", action: "create_issue", field: "estimateHours", mode: "warn", message: "An effort estimate (hours) should be set for resource planning (Waterfall)." },
    ],
  },
  prince2: {
    methodology: "prince2",
    label: "PRINCE2 management-products baseline",
    rationale:
      "Process-driven control: tasks are described and dated, and identified risks carry a mitigation.",
    modes: { ...SCHEDULE_SANITY, "require-description": "hard" },
    fieldRules: [
      { id: "prince2-start", action: "create_issue", field: "startDate", mode: "warn", message: "Set a start date for stage planning (PRINCE2)." },
      { id: "prince2-due", action: "create_issue", field: "dueDate", mode: "warn", message: "Set a target finish for stage planning (PRINCE2)." },
      { id: "prince2-risk-mitigation", action: "any-write", field: "mitigation", whenPresent: "riskLevel", mode: "warn", message: "A rated risk should record its mitigation (PRINCE2 risk management)." },
    ],
  },
  safe: {
    methodology: "safe",
    label: "SAFe scaled-agile baseline",
    rationale:
      "Backlog items are owned and estimated for PI planning, and blocked work is made explicit across teams.",
    modes: { ...SCHEDULE_SANITY, "require-assignee": "warn" },
    fieldRules: [
      { id: "safe-estimate", action: "create_issue", field: "storyPoints", mode: "warn", message: "Backlog items should be estimated for PI planning (SAFe)." },
      { id: "safe-blocked-reason", action: "any-write", field: "blockedReason", whenPresent: "blocked", mode: "warn", message: "Blocked work must be explicit across the ART (SAFe)." },
    ],
  },
};

/** The reference ruleset bundle for a methodology (a deep copy), or undefined. */
export function getReferenceRuleset(methodology: string): ReferenceRuleset | undefined {
  const rs = REFERENCE_RULESETS[methodology];
  return rs ? { ...rs, modes: { ...rs.modes }, fieldRules: rs.fieldRules.map((r) => ({ ...r })) } : undefined;
}

/** All reference ruleset bundles, ordered to match the methodology catalogue. */
export function referenceRulesetCatalogue(): ReferenceRuleset[] {
  // Ordered to match the methodology catalogue so the two planes line up.
  return METHODOLOGIES.map((m) => getReferenceRuleset(m.id)).filter((x): x is ReferenceRuleset => x !== undefined);
}
