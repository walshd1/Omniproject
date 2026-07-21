import type { RuleMode, FieldRule } from "./ruleset";
import { readScopedConfigValue, writeScopedConfigCollection, type ConfigWriteScope } from "./scoped-config";

/**
 * SCOPED RULESET OVERLAY — lets a programme or project TIGHTEN the org's business ruleset for its own work,
 * never loosen it. The ruleset is restrict-only by design (a rule can block or warn, never grant), so the only
 * coherent local variation is to be STRICTER: raise a rule's mode (off < warn < hard) or require MORE fields.
 * This module folds an org baseline with the scope's stored overrides under exactly that tighten-only rule, so
 * a nearer scope can harden a gate but a malicious/mistaken override can never open one. Gated at the write
 * seam by the delegation policy (how deep local variation is allowed at all).
 */

export const RULESET_OVERRIDE_ID = "ruleset-override";

/** Strictness rank — a higher rank is stricter. Tightening = moving up. */
const MODE_RANK: Record<RuleMode, number> = { off: 0, warn: 1, hard: 2 };

/** The stricter of two modes (used to tighten, never loosen). */
export function stricterMode(a: RuleMode, b: RuleMode): RuleMode {
  return MODE_RANK[b] > MODE_RANK[a] ? b : a;
}

/** One scope's stored ruleset override — partial modes and/or extra field rules it wants to enforce. */
export interface RulesetOverride {
  modes?: Record<string, RuleMode>;
  fieldRules?: FieldRule[];
}

/** Fold an override's MODES onto a base, keeping only the stricter mode per rule (tighten-only). */
export function tightenModes(base: Record<string, RuleMode>, override: Record<string, RuleMode> | undefined): Record<string, RuleMode> {
  const out: Record<string, RuleMode> = { ...base };
  if (override) for (const [id, mode] of Object.entries(override)) {
    if (mode in MODE_RANK) out[id] = stricterMode(out[id] ?? "off", mode);
  }
  return out;
}

/**
 * Fold an override's FIELD RULES onto a base. A base rule is kept; if the override carries the same id, its mode
 * may only be RAISED (tightened). An override-only field rule is ADDED (requiring more is a tightening). An
 * override can never DROP a base rule or lower its mode.
 */
export function tightenFieldRules(base: FieldRule[], override: FieldRule[] | undefined): FieldRule[] {
  if (!override?.length) return base.map((r) => ({ ...r }));
  const byId = new Map(base.map((r) => [r.id, { ...r }]));
  for (const o of override) {
    const existing = byId.get(o.id);
    if (existing) existing.mode = stricterMode(existing.mode, o.mode);
    else byId.set(o.id, { ...o });
  }
  return [...byId.values()];
}

/** Fold one override onto an effective ruleset (tighten-only, both facets). */
function tighten(base: { modes: Record<string, RuleMode>; fieldRules: FieldRule[] }, override: RulesetOverride | undefined): { modes: Record<string, RuleMode>; fieldRules: FieldRule[] } {
  if (!override) return base;
  return { modes: tightenModes(base.modes, override.modes), fieldRules: tightenFieldRules(base.fieldRules, override.fieldRules) };
}

/**
 * Resolve the EFFECTIVE ruleset for a request scope: the org baseline, tightened by the programme override (if
 * any), then the project override (if any) — system < org < programme < project, each only able to make things
 * stricter. With no stored overrides this returns the baseline unchanged, so behaviour is identical to org-only
 * until a scope opts to harden.
 */
export function resolveEffectiveRuleset(
  base: { modes: Record<string, RuleMode>; fieldRules: FieldRule[] },
  scopes: { programmeId?: string | null | undefined; projectId?: string | null | undefined },
): { modes: Record<string, RuleMode>; fieldRules: FieldRule[] } {
  let eff = { modes: { ...base.modes }, fieldRules: base.fieldRules.map((r) => ({ ...r })) };
  if (scopes.programmeId) eff = tighten(eff, readScopedConfigValue<RulesetOverride>(RULESET_OVERRIDE_ID, { kind: "programme", programmeId: scopes.programmeId }));
  if (scopes.projectId) eff = tighten(eff, readScopedConfigValue<RulesetOverride>(RULESET_OVERRIDE_ID, { kind: "project", projectId: scopes.projectId }));
  return eff;
}

/** The stored override for one scope (for an admin UI to read/edit), or undefined. */
export function getRulesetOverride(scope: ConfigWriteScope): RulesetOverride | undefined {
  return readScopedConfigValue<RulesetOverride>(RULESET_OVERRIDE_ID, scope);
}

/** Persist a scope's ruleset override (already delegation-gated by the caller). Sanitises to valid modes +
 *  well-formed field rules so a stored override can only ever be applied as a tightening. */
export function setRulesetOverride(scope: ConfigWriteScope, override: RulesetOverride): RulesetOverride {
  const modes: Record<string, RuleMode> = {};
  // Inline proto-key guard (CodeQL's remote-property-injection barrier recognises the literal comparison).
  for (const [id, mode] of Object.entries(override.modes ?? {})) if (typeof mode === "string" && mode in MODE_RANK && id !== "__proto__" && id !== "constructor" && id !== "prototype") modes[id] = mode as RuleMode;
  const fieldRules = (Array.isArray(override.fieldRules) ? override.fieldRules : []).filter(isFieldRule);
  const clean: RulesetOverride = { modes, fieldRules };
  writeScopedConfigCollection(RULESET_OVERRIDE_ID, "Ruleset override", clean, scope);
  return clean;
}

/** A well-formed field rule (mirrors ruleset.ts's private guard; restrict-only shape). */
function isFieldRule(x: unknown): x is FieldRule {
  const r = x as FieldRule;
  return !!r && typeof r.id === "string" && typeof r.action === "string" && typeof r.field === "string"
    && (["hard", "warn", "off"] as string[]).includes(r.mode) && (r.whenPresent === undefined || typeof r.whenPresent === "string");
}
