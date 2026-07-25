import type { RuleMode, FieldRule } from "./ruleset";
import { readScopedConfigValue, writeScopedConfigCollection, type ConfigWriteScope } from "./scoped-config";
import { foldAccounting, sanitizeAccountingValues, type AccountingConfig, type AccountingOverride } from "./accounting-policy";

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

/** One scope's stored ruleset override — partial modes and/or extra field rules it wants to enforce, plus any
 *  accounting-policy overrides. Modes/fields TIGHTEN-only; accounting values plain-OVERRIDE (nearest wins). */
export interface RulesetOverride {
  modes?: Record<string, RuleMode>;
  fieldRules?: FieldRule[];
  accounting?: AccountingOverride;
}

/** The effective finance governance at a scope — the block/warn gates AND the accounting policy, resolved as one. */
export interface EffectiveRuleset {
  modes: Record<string, RuleMode>;
  fieldRules: FieldRule[];
  accounting: AccountingConfig;
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

/** Fold one override onto an effective ruleset: modes/fields TIGHTEN-only; accounting values plain-OVERRIDE
 *  (nearest wins — an account code / factor has no "stricter"). */
function tighten(base: EffectiveRuleset, override: RulesetOverride | undefined): EffectiveRuleset {
  if (!override) return base;
  return {
    modes: tightenModes(base.modes, override.modes),
    fieldRules: tightenFieldRules(base.fieldRules, override.fieldRules),
    accounting: foldAccounting(base.accounting, override.accounting),
  };
}

/**
 * Resolve the EFFECTIVE finance governance for a request scope: the org baseline, folded by the programme override
 * (if any), then the project override (if any) — system < org < programme < project. Rule modes and field rules
 * can only be made STRICTER; accounting-policy values are OVERRIDDEN by a nearer scope (nearest wins). With no
 * stored overrides this returns the baseline unchanged.
 */
export function resolveEffectiveRuleset(
  base: EffectiveRuleset,
  scopes: { programmeId?: string | null | undefined; projectId?: string | null | undefined },
): EffectiveRuleset {
  let eff: EffectiveRuleset = { modes: { ...base.modes }, fieldRules: base.fieldRules.map((r) => ({ ...r })), accounting: { ...base.accounting, accounts: { ...base.accounting.accounts } } };
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
  for (const [id, mode] of Object.entries(override.modes ?? {})) {
    if (id === "__proto__" || id === "constructor" || id === "prototype") continue; // standalone proto-key barrier
    if (typeof mode === "string" && mode in MODE_RANK) modes[id] = mode as RuleMode;
  }
  const fieldRules = (Array.isArray(override.fieldRules) ? override.fieldRules : []).filter(isFieldRule);
  const clean: RulesetOverride = { modes, fieldRules };
  // Accounting overrides are validated to the same partial shape as the org baseline (id-safe codes, bounded
  // factor, valid method); an invalid override is rejected rather than silently dropped.
  if (override.accounting !== undefined) clean.accounting = sanitizeAccountingValues(override.accounting);
  writeScopedConfigCollection(RULESET_OVERRIDE_ID, "Ruleset override", clean, scope);
  return clean;
}

/** A well-formed field rule (mirrors ruleset.ts's private guard; restrict-only shape). */
function isFieldRule(x: unknown): x is FieldRule {
  const r = x as FieldRule;
  return !!r && typeof r.id === "string" && typeof r.action === "string" && typeof r.field === "string"
    && (["hard", "warn", "off"] as string[]).includes(r.mode) && (r.whenPresent === undefined || typeof r.whenPresent === "string");
}
