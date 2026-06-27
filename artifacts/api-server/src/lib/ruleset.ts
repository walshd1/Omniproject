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

export type RuleMode = "hard" | "warn" | "off";

export interface RuleContext {
  action: string; // "create_issue" | "update_issue" | "delete_issue" | …
  write: boolean;
  role: string; // already RBAC-passed (hard gate ran first)
  projectId?: string | null;
  payload?: Record<string, unknown>;
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
];

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
  const m = getRuleModes();
  const warnings: { id: string; message: string }[] = [];
  for (const r of BUSINESS_RULES) {
    const mode = m[r.id]!;
    if (mode === "off") continue;
    if (!r.applies(ctx)) continue;
    if (mode === "hard") return { allow: false, blocked: { id: r.id, message: r.message(ctx) }, warnings };
    warnings.push({ id: r.id, message: r.message(ctx) });
  }
  return { allow: true, blocked: null, warnings };
}

/** Test-only reset to the env-seeded modes. */
export function resetRuleModes(): void {
  modes = seedModes();
}
