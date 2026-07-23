/**
 * Business ruleset engine — EXTRA, admin-configurable rules layered ON TOP of the
 * hard ruleset. Each rule has a mode: "hard" (block the action), "warn" (allow but
 * record a warning), or "off" (not enforced).
 *
 * ── SAFETY: this can only TIGHTEN, never loosen ────────────────────────────────
 *  - It runs AFTER the hard gates (RBAC `requireRole`, capability gating, the
 *    contract guards). Those always run regardless of any business rule.
 *  - A rule can only DENY ("hard") or WARN — there is NO mode that GRANTS. Setting
 *    a rule to "off" disables THAT business rule only; it never touches RBAC or any
 *    hard guarantee. So the business ruleset can't be used to escalate privilege or
 *    bypass a hard rule — it is purely additive/restrictive.
 *  - Operators toggle a rule's MODE; they cannot author predicates (no code
 *    injection), and no rule definition is allowed to return "allow".
 */
import { logger } from "./logger";
import { resolveEffectiveRuleset } from "./ruleset-scope";

export type RuleMode = "hard" | "warn" | "off";

export interface RuleContext {
  action: string; // "create_issue" | "update_issue" | "delete_issue" | …
  write: boolean;
  role: string; // already RBAC-passed (hard gate ran first)
  projectId?: string | null;
  /** The programme the work belongs to, when known — lets a programme-scope ruleset override apply. */
  programmeId?: string | null;
  payload?: Record<string, unknown> | undefined;
}

export interface BusinessRule {
  id: string;
  label: string;
  description: string;
  defaultMode: RuleMode;
  /** Pure predicate: does this rule APPLY to the action? (never grants) */
  applies: (ctx: RuleContext) => boolean;
  message: (ctx: RuleContext) => string;
}

export interface RuleVerdict {
  /** false ONLY when a hard rule applies. Never used to grant. */
  allow: boolean;
  blocked: { id: string; message: string } | null;
  warnings: { id: string; message: string }[];
}

const has = (p: Record<string, unknown> | undefined, k: string): boolean => p != null && p[k] != null && p[k] !== "";

/** A priority is "set" only when it's a REAL level — not null/empty, and not the `"none"` sentinel the
 *  UI sends for an unset priority. So require-priority treats `priority: "none"` as absent (otherwise the
 *  rule would be trivially satisfied by the default the create forms send). */
const hasPriority = (p: Record<string, unknown> | undefined): boolean => {
  const v = p?.["priority"];
  return typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "none";
};

/** Coerce a payload value to epoch-ms, or null if it isn't a usable date. Accepts
 *  Date, ISO string, or epoch number (zod `coerce.date` may hand us any of these). */
function asTime(v: unknown): number | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Built-in rules. Operators toggle each rule's MODE; the predicates are fixed. */
export const BUSINESS_RULES: BusinessRule[] = [
  {
    id: "read-only", label: "Global read-only", description: "Block ALL writes — a portfolio freeze.", defaultMode: "off",
    applies: (c) => c.write, message: () => "Writes are frozen by the read-only business rule.",
  },
  {
    id: "no-deletes", label: "No deletions", description: "Block delete actions.", defaultMode: "off",
    applies: (c) => /^delete_/.test(c.action), message: () => "Deletions are disabled by business rule.",
  },
  {
    id: "require-assignee", label: "Require an assignee", description: "New/updated issues must carry an assignee.", defaultMode: "off",
    applies: (c) => (c.action === "create_issue" || c.action === "update_issue") && !has(c.payload, "assignee"), message: () => "An assignee is required (business rule).",
  },
  {
    id: "require-description", label: "Require a description", description: "New issues must have a description.", defaultMode: "off",
    applies: (c) => c.action === "create_issue" && !has(c.payload, "description"), message: () => "A description is required on new issues (business rule).",
  },
  {
    // Applies to BOTH the GTD task and the issue create/update, since both carry a priority and the
    // product's "task" surface spans both. Uses hasPriority (not `has`) so the UI's "none" default
    // counts as unset. Off by default — an org turns it on through the business ruleset.
    id: "require-priority", label: "Require a priority", description: "New or updated tasks and issues must carry a priority.", defaultMode: "off",
    applies: (c) => ["create_issue", "update_issue", "create_task", "update_task"].includes(c.action) && !hasPriority(c.payload),
    message: () => "A priority is required (business rule).",
  },
  {
    // A cross-field comparison — something the field-rule mechanism (presence only)
    // cannot express, so it lives here as a fixed predicate. Off by default.
    id: "due-after-start", label: "Due date not before start", description: "An issue's due date must not fall before its start date.", defaultMode: "off",
    applies: (c) => {
      if (c.action !== "create_issue" && c.action !== "update_issue") return false;
      const start = asTime(c.payload?.["startDate"]);
      const due = asTime(c.payload?.["dueDate"]);
      return start !== null && due !== null && due < start;
    },
    message: () => "The due date cannot be earlier than the start date (business rule).",
  },
];

/**
 * Admin-authored FIELD rules — "what must go in fields" + dependency enforcement.
 * Data, not code (just field-presence, fixed logic — still restrict-only):
 *  - required field:  { action: "create_issue", field: "estimateHours", mode: "hard" }
 *                     → "no task can be created without an effort estimate".
 *  - dependency:      { action: "create_issue", field: "costCenter",
 *                       whenPresent: "billable", mode: "warn" }
 *                     → costCenter required ONLY when billable is set.
 */
export interface FieldRule {
  id: string;
  /** Exact action ("create_issue") or "any-write". */
  action: string;
  /** The field that must be present + non-empty. */
  field: string;
  /** Dependency: only required when THIS field is present. */
  whenPresent?: string;
  mode: RuleMode;
  message?: string;
}

// ── Admin-configurable modes (in-memory; seed from BUSINESS_RULE_MODES JSON) ──
const VALID: RuleMode[] = ["hard", "warn", "off"];

function seedModes(): Record<string, RuleMode> {
  const out: Record<string, RuleMode> = {};
  const raw = process.env["BUSINESS_RULE_MODES"]?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const r of BUSINESS_RULES) if (typeof parsed[r.id] === "string" && (VALID as string[]).includes(parsed[r.id] as string)) out[r.id] = parsed[r.id] as RuleMode;
    } catch {
      logger.warn("BUSINESS_RULE_MODES is not valid JSON — ignoring");
    }
  }
  return out;
}
let modes: Record<string, RuleMode> = seedModes();

function isFieldRule(x: unknown): x is FieldRule {
  const r = x as FieldRule;
  return !!r && typeof r.id === "string" && typeof r.action === "string" && typeof r.field === "string"
    && (VALID as string[]).includes(r.mode) && (r.whenPresent === undefined || typeof r.whenPresent === "string");
}
function seedFieldRules(): FieldRule[] {
  const raw = process.env["BUSINESS_FIELD_RULES"]?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isFieldRule) : [];
  } catch {
    logger.warn("BUSINESS_FIELD_RULES is not valid JSON — ignoring");
    return [];
  }
}
let fieldRules: FieldRule[] = seedFieldRules();

/** The current admin-authored field rules (a defensive copy). */
export function getFieldRules(): FieldRule[] {
  return fieldRules.map((r) => ({ ...r }));
}

/** Admin replaces the field-rule set. Only well-formed rules (valid mode, string
 *  action/field) are accepted — they can only REQUIRE a field, never grant. Malformed entries
 *  are dropped silently from the applied set but logged, so a typo'd rule doesn't just vanish
 *  without a trace (matching the env-seed path's `logger.warn` on bad JSON). */
export function setFieldRules(next: unknown): FieldRule[] {
  if (Array.isArray(next)) {
    const dropped = next.length - next.filter(isFieldRule).length;
    if (dropped > 0) logger.warn({ dropped }, "setFieldRules: ignoring malformed field rule(s)");
    fieldRules = next.filter(isFieldRule).map((r) => ({ id: r.id, action: r.action, field: r.field, mode: r.mode, ...(r.whenPresent ? { whenPresent: r.whenPresent } : {}), ...(r.message ? { message: r.message } : {}) }));
  }
  return getFieldRules();
}

/** The effective mode of every rule (configured, else its default). */
export function getRuleModes(): Record<string, RuleMode> {
  const full: Record<string, RuleMode> = {};
  for (const r of BUSINESS_RULES) full[r.id] = modes[r.id] ?? r.defaultMode;
  return full;
}

/** Admin sets modes. ONLY known rule ids + valid modes are accepted — there is no
 *  path to add a rule or a mode that grants. */
export function setRuleModes(next: Record<string, unknown>): Record<string, RuleMode> {
  for (const r of BUSINESS_RULES) {
    const m = next[r.id];
    if (typeof m === "string" && (VALID as string[]).includes(m)) modes[r.id] = m as RuleMode;
  }
  return getRuleModes();
}

/**
 * Apply a named reference ruleset bundle (modes + field rules) atomically and
 * DETERMINISTICALLY: every built-in resets to "off" first, then the bundle's modes
 * apply, and the field-rule set is replaced wholesale. Restrict-only is preserved —
 * this routes through setRuleModes/setFieldRules, which only accept known ids, valid
 * modes and well-formed field rules, so a bundle can never grant or loosen a gate.
 */
export function applyRuleset(bundle: { modes: Record<string, RuleMode>; fieldRules: unknown }): {
  modes: Record<string, RuleMode>;
  fieldRules: FieldRule[];
} {
  const full: Record<string, RuleMode> = {};
  for (const r of BUSINESS_RULES) full[r.id] = bundle.modes[r.id] ?? "off";
  setRuleModes(full);
  setFieldRules(bundle.fieldRules);
  return { modes: getRuleModes(), fieldRules: getFieldRules() };
}

/** The catalogue for an admin UI (rule + current mode). */
export function rulesetCatalogue() {
  const m = getRuleModes();
  return BUSINESS_RULES.map((r) => ({ id: r.id, label: r.label, description: r.description, mode: m[r.id]!, defaultMode: r.defaultMode }));
}

/**
 * Evaluate the business ruleset for an action. RESTRICT-ONLY: returns a hard block
 * OR warnings; it never grants. Call this AFTER the hard gates have already passed.
 */
export function evaluateRuleset(ctx: RuleContext): RuleVerdict {
  // Resolve the EFFECTIVE ruleset for this scope: the org baseline, tightened (never loosened) by any
  // programme/project override. With no overrides this is identical to the org ruleset.
  const eff = resolveEffectiveRuleset(
    { modes: getRuleModes(), fieldRules: getFieldRules() },
    { programmeId: ctx.programmeId, projectId: ctx.projectId },
  );
  const m = eff.modes;
  const warnings: { id: string; message: string }[] = [];
  // 1. Built-in rules.
  for (const r of BUSINESS_RULES) {
    const mode = m[r.id] ?? "off";
    if (mode === "off") continue;
    if (!r.applies(ctx)) continue;
    if (mode === "hard") return { allow: false, blocked: { id: r.id, message: r.message(ctx) }, warnings };
    warnings.push({ id: r.id, message: r.message(ctx) });
  }
  // 2. Admin field rules ("what must go in fields" + dependencies) — the effective (scope-tightened) set.
  for (const fr of eff.fieldRules) {
    if (fr.mode === "off") continue;
    const actionMatch = fr.action === ctx.action || (fr.action === "any-write" && ctx.write);
    if (!actionMatch) continue;
    if (fr.whenPresent && !has(ctx.payload, fr.whenPresent)) continue; // dependency not triggered
    if (has(ctx.payload, fr.field)) continue; // requirement satisfied
    const message = fr.message ?? (fr.whenPresent ? `'${fr.field}' is required when '${fr.whenPresent}' is set (business rule).` : `'${fr.field}' is required (business rule).`);
    if (fr.mode === "hard") return { allow: false, blocked: { id: fr.id, message }, warnings };
    warnings.push({ id: fr.id, message });
  }
  return { allow: true, blocked: null, warnings };
}

/** Built-in rules that are a simple "field X must be present on these actions" — the subset a CLIENT can
 *  pre-check to nudge before submit. Cross-field / global rules (due-after-start, read-only, no-deletes)
 *  can't be checked field-by-field, so they're enforced server-side only and omitted from this view. */
const FIELD_REQUIREMENT_BUILTINS: readonly { id: string; field: string; actions: readonly string[] }[] = [
  { id: "require-priority", field: "priority", actions: ["create_issue", "update_issue", "create_task", "update_task"] },
  { id: "require-assignee", field: "assignee", actions: ["create_issue", "update_issue"] },
  { id: "require-description", field: "description", actions: ["create_issue"] },
];

/** One field requirement the entry UI can enforce inline: field X is required (hard) or recommended
 *  (warn) for `action`, in the caller's scope. `whenPresent` mirrors a dependency field rule. */
export interface EntryRequirement { rule: string; action: string; field: string; mode: "hard" | "warn"; message: string; whenPresent?: string }

/**
 * The effective FIELD requirements for entry, distilled so a client can push back inline BEFORE submit
 * (the server still enforces the full ruleset authoritatively on every write). Folds the on field-
 * requirement built-ins together with the admin field rules, resolved for the given scope (org baseline,
 * tightened — never loosened — by any programme/project override).
 */
export function entryRequirements(scope: { programmeId?: string | null; projectId?: string | null } = {}): EntryRequirement[] {
  const eff = resolveEffectiveRuleset({ modes: getRuleModes(), fieldRules: getFieldRules() }, scope);
  const byId = new Map(BUSINESS_RULES.map((r) => [r.id, r] as const));
  const out: EntryRequirement[] = [];
  for (const b of FIELD_REQUIREMENT_BUILTINS) {
    const mode = eff.modes[b.id] ?? "off";
    if (mode === "off") continue;
    const message = byId.get(b.id)?.message({ action: b.actions[0]!, write: true, role: "" }) ?? `'${b.field}' is required (business rule).`;
    for (const action of b.actions) out.push({ rule: b.id, action, field: b.field, mode, message });
  }
  for (const fr of eff.fieldRules) {
    if (fr.mode === "off") continue;
    out.push({ rule: fr.id, action: fr.action, field: fr.field, mode: fr.mode, message: fr.message ?? `'${fr.field}' is required (business rule).`, ...(fr.whenPresent ? { whenPresent: fr.whenPresent } : {}) });
  }
  return out;
}

/** Test-only reset to the env-seeded config. */
export function resetRuleModes(): void {
  modes = seedModes();
  fieldRules = seedFieldRules();
}
