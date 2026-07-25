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

/** Coerce a payload value to epoch-ms, or null if it isn't a usable date. Accepts
 *  Date, ISO string, or epoch number (zod `coerce.date` may hand us any of these). */
function asTime(v: unknown): number | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Coerce a payload value to a finite number, else 0 (for money/quantity summing). */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Sum debit + credit across a journal-entry payload's `lines[]` (tolerating `journalDebit`/`debit` and
 *  `journalCredit`/`credit` member names), or null when the payload carries no assessable lines. */
function journalTotals(payload: Record<string, unknown> | undefined): { debit: number; credit: number } | null {
  const lines = Array.isArray(payload?.["lines"]) ? (payload!["lines"] as unknown[]) : null;
  if (!lines || lines.length === 0) return null;
  let debit = 0, credit = 0;
  for (const ln of lines) {
    const r = (ln ?? {}) as Record<string, unknown>;
    debit += num(r["journalDebit"] ?? r["debit"]);
    credit += num(r["journalCredit"] ?? r["credit"]);
  }
  return { debit, credit };
}

/** Lower-cased string of a payload field, or "" — for reading a resolved status stamped on the write. */
const lower = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

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
  // ── Finance controls (finance superset F14) — the accounting invariants a finance system enforces. All
  //    default OFF (opt-in like every rule); a finance deployment turns them `hard` via the org ruleset. ──
  {
    id: "finance-journal-balanced", label: "Journal entries must balance",
    description: "A journal entry's total debits must equal its total credits (double-entry).", defaultMode: "off",
    applies: (c) => {
      if (c.action !== "create_journal_entry" && c.action !== "update_journal_entry") return false;
      const t = journalTotals(c.payload);
      return t !== null && Math.round((t.debit - t.credit) * 100) !== 0; // unbalanced → applies
    },
    message: (c) => {
      const t = journalTotals(c.payload)!;
      return `A journal entry must balance: total debits (${t.debit}) must equal total credits (${t.credit}).`;
    },
  },
  {
    id: "finance-no-post-closed-period", label: "No posting to a closed period",
    description: "A journal entry cannot post into a closed or locked accounting period.", defaultMode: "off",
    applies: (c) => {
      if (c.action !== "create_journal_entry" && c.action !== "update_journal_entry") return false;
      const st = lower(c.payload?.["journalPeriodStatus"] ?? c.payload?.["periodStatus"]);
      return st === "closed" || st === "locked"; // the write resolves + stamps the period's status
    },
    message: () => "Cannot post to a closed or locked accounting period (business rule).",
  },
  {
    id: "finance-posted-immutable", label: "Posted entries are immutable",
    description: "A posted journal entry cannot be edited — reverse it with a new entry instead.", defaultMode: "off",
    applies: (c) => c.action === "update_journal_entry" && lower(c.payload?.["journalPostingStatus"]) === "posted",
    message: () => "A posted journal entry is immutable — post a reversing entry instead of editing it (business rule).",
  },
  {
    id: "finance-journal-period", label: "Journal entry needs a period",
    description: "A new journal entry must be posted into a fiscal period.", defaultMode: "off",
    applies: (c) => c.action === "create_journal_entry" && !has(c.payload, "journalFiscalPeriod"),
    message: () => "A journal entry must be posted into a fiscal period (business rule).",
  },
  {
    id: "finance-journal-posting-date", label: "Journal entry needs a posting date",
    description: "A new journal entry must carry a posting date.", defaultMode: "off",
    applies: (c) => c.action === "create_journal_entry" && !has(c.payload, "journalPostingDate"),
    message: () => "A journal entry must carry a posting date (business rule).",
  },
  {
    // Finance superset F16 — tax must be accounted for where a jurisdiction applies.
    id: "finance-tax-required", label: "Tax required where a jurisdiction applies",
    description: "An invoice or bill in a tax jurisdiction must carry a tax amount (or an explicit reverse-charge / zero-rating).", defaultMode: "off",
    applies: (c) => (c.action === "create_invoice" || c.action === "update_invoice" || c.action === "create_bill")
      && has(c.payload, "taxRateJurisdiction") && !has(c.payload, "taxAmount") && c.payload?.["reverseCharge"] !== true,
    message: () => "A tax amount is required when a tax jurisdiction applies — set the tax, or mark it reverse-charge (business rule).",
  },
  {
    // Finance superset F17 — a bill cannot be approved until it is matched to its PO + goods receipt.
    id: "finance-3way-match", label: "Bill approval requires a 3-way match",
    description: "A bill cannot be approved unless its match status is `matched` (invoice ↔ PO ↔ goods receipt).", defaultMode: "off",
    applies: (c) => (c.action === "update_bill" || c.action === "approve_bill")
      && lower(c.payload?.["approvalState"]) === "approved" && lower(c.payload?.["matchStatus"]) !== "matched",
    message: () => "A bill cannot be approved until it is matched to its purchase order and goods receipt (business rule).",
  },
  {
    // Finance superset F18 — no new AR to a customer on credit hold.
    id: "finance-credit-hold", label: "No new billing to a customer on credit hold",
    description: "Block a new invoice or quote when the customer is on credit hold.", defaultMode: "off",
    applies: (c) => (c.action === "create_invoice" || c.action === "create_quote") && c.payload?.["creditHold"] === true,
    message: () => "The customer is on credit hold — new invoices/quotes are blocked until the hold is cleared (business rule).",
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

/** Test-only reset to the env-seeded config. */
export function resetRuleModes(): void {
  modes = seedModes();
  fieldRules = seedFieldRules();
}
