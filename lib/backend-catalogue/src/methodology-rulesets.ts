import { METHODOLOGIES } from "./methodology-catalogue";
import { REFERENCE_RULESETS_DATA } from "./methodology-rulesets.generated";

/**
 * REFERENCE RULESETS — a curated, named business-ruleset bundle per methodology,
 * to help a PMO get compliance + completeness right out of the box.
 *
 * These are *data*: each bundle is authored as JSON under
 * assets/methodology-rulesets/<id>.json (id = the methodology id), validated + embedded by
 * gen-methodology-rulesets (drift-guarded in CI) — exactly like the methodology catalogue. The
 * bundle is just a set of built-in rule MODES plus FIELD rules, in the neutral shape the
 * business-ruleset engine consumes (`lib/ruleset.ts`). Applying one inherits every safety
 * guarantee of the engine — it is **restrict-only** (it can only set a rule to hard/warn/off
 * and require a field; it can never grant, escalate, or loosen a hard gate). A PMO reviews and
 * applies one; nothing here runs on its own.
 *
 * The modes map only lists rules a methodology actively wants ON — applying a bundle sets every
 * other built-in to "off", so "apply Scrum" is deterministic. They are *reference* mappings:
 * sensible defaults to confirm + tune, not law.
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

/** The authored asset shape (`id` is the methodology id). */
export interface ReferenceRulesetData {
  id: string;
  label: string;
  /** Why these rules aid this methodology's compliance + completeness. */
  rationale: string;
  /** Built-in rule modes to set ON (every unlisted built-in applies as "off"). */
  modes: Record<string, RuleMode>;
  /** The field rules to load. */
  fieldRules: ReferenceFieldRule[];
}

/** The public bundle — the data plus `methodology` (= id) for the ruleset API + engine. */
export interface ReferenceRuleset extends ReferenceRulesetData {
  /** The methodology id this bundle belongs to (matches the methodology plane). */
  methodology: string;
}

const byId = new Map(REFERENCE_RULESETS_DATA.map((d) => [d.id, d]));

/** The reference ruleset bundle for a methodology (a deep copy), or undefined. */
export function getReferenceRuleset(methodology: string): ReferenceRuleset | undefined {
  const d = byId.get(methodology);
  return d ? { ...d, methodology: d.id, modes: { ...d.modes }, fieldRules: d.fieldRules.map((r) => ({ ...r })) } : undefined;
}

/** All reference ruleset bundles, ordered to match the methodology catalogue (so the planes line up). */
export function referenceRulesetCatalogue(): ReferenceRuleset[] {
  return METHODOLOGIES.map((m) => getReferenceRuleset(m.id)).filter((x): x is ReferenceRuleset => x !== undefined);
}
