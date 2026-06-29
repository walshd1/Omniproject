import { sharedKv } from "./shared-state";

/**
 * AI governance — opt-in cost control + data-loss prevention layered on the single model-egress
 * chokepoint (lib/ai `aiChat`). All three controls are OFF by default (no env ⇒ no change):
 *
 *  - **Prompt DLP redaction** (`AI_DLP_REDACT=true`): mask PII / secrets in prompt content BEFORE
 *    it leaves the gateway — emails, card numbers, API keys / bearer tokens, long phone numbers.
 *  - **Per-role model allowlist** (`AI_MODEL_ALLOWLIST="role=modelA|modelB,role2=*"`): a role may
 *    only use the models it's allowed (e.g. keep an expensive model to admins).
 *  - **Token budget / quota** (`AI_TOKEN_BUDGET`, per scope per window): a soft cap on tokens per
 *    scope (the user `sub`, or a team) over `AI_BUDGET_WINDOW_HOURS` (default 24). The running
 *    counters live in the shared-state seam, so the budget is fleet-wide when Redis is configured.
 *
 * Token counts are APPROXIMATE (chars/4 — providers don't return usage uniformly); the budget is
 * a soft signal + chargeback aid, not a hard biller. For hard limits use the provider's own quota.
 */

// ── Prompt DLP redaction ────────────────────────────────────────────────────────
export function dlpEnabled(): boolean {
  return process.env["AI_DLP_REDACT"]?.trim().toLowerCase() === "true";
}

// Order matters: mask the most specific (secrets, cards) before the looser patterns.
const REDACTIONS: { re: RegExp; with: string }[] = [
  { re: /\b(?:sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,}|gh[pous]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, with: "[redacted-secret]" },
  { re: /\bBearer\s+[A-Za-z0-9._-]{12,}\b/g, with: "Bearer [redacted-token]" },
  { re: /\b(?:\d[ -]?){13,16}\b/g, with: "[redacted-card]" },
  { re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, with: "[redacted-email]" },
  { re: /\+?\d[\d\s().-]{8,}\d/g, with: "[redacted-phone]" },
];

/** Mask PII/secrets in a string; returns the masked text and how many spans were redacted. */
export function redactText(text: string): { text: string; redactions: number } {
  let out = text;
  let count = 0;
  for (const r of REDACTIONS) {
    out = out.replace(r.re, () => { count++; return r.with; });
  }
  return { text: out, redactions: count };
}

/** Redact every message's content before egress; returns the new messages + total redactions.
 *  Generic so it preserves the caller's exact message type (e.g. the role union). */
export function redactForEgress<T extends { content: string }>(messages: T[]): { messages: T[]; redactions: number } {
  let redactions = 0;
  const masked = messages.map((m) => {
    const r = redactText(m.content);
    redactions += r.redactions;
    return { ...m, content: r.text };
  });
  return { messages: masked, redactions };
}

// ── Per-role model allowlist ───────────────────────────────────────────────────────
/** Parse AI_MODEL_ALLOWLIST ("role=a|b,role2=*") → role → set (or "*"). Null when unconfigured. */
function modelAllowlist(): Map<string, Set<string> | "*"> | null {
  const raw = process.env["AI_MODEL_ALLOWLIST"]?.trim();
  if (!raw) return null;
  const map = new Map<string, Set<string> | "*">();
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const role = pair.slice(0, eq).trim().toLowerCase();
    const models = pair.slice(eq + 1).trim();
    if (!role) continue;
    map.set(role, models === "*" ? "*" : new Set(models.split("|").map((m) => m.trim()).filter(Boolean)));
  }
  return map.size ? map : null;
}

/** May this role use this model? True when no allowlist is configured, or the role has no entry
 *  (unlisted roles are unrestricted — restrict explicitly). */
export function modelAllowed(role: string | undefined, model: string): boolean {
  const list = modelAllowlist();
  if (!list || !role) return true;
  const allowed = list.get(role.toLowerCase());
  if (allowed === undefined) return true;
  return allowed === "*" || allowed.has(model);
}

// ── Token budget / quota (shared-state backed) ─────────────────────────────────────
export function tokenBudget(): number {
  const n = Number(process.env["AI_TOKEN_BUDGET"]);
  return Number.isFinite(n) && n > 0 ? n : 0; // 0 ⇒ no budget
}
function windowMs(): number {
  const h = Number(process.env["AI_BUDGET_WINDOW_HOURS"]);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 60 * 60 * 1000;
}
/** Rough token estimate (chars/4) over a set of messages. */
export function estimateTokens(messages: { content: string }[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(chars / 4);
}

function budgetKey(scope: string, now: number): string {
  return `ai:bud:${scope}:${Math.floor(now / windowMs())}`;
}

export interface BudgetVerdict { ok: boolean; used: number; limit: number }

/** Check (without reserving) whether `estTokens` more would exceed the scope's budget. */
export async function checkBudget(scope: string, estTokens: number, now: number = Date.now()): Promise<BudgetVerdict> {
  const limit = tokenBudget();
  if (limit <= 0) return { ok: true, used: 0, limit: 0 };
  const used = Number((await sharedKv.get(budgetKey(scope, now))) ?? 0);
  return { ok: used + estTokens <= limit, used, limit };
}

/** Add `tokens` to the scope's running total for the current window (soft, best-effort). */
export async function recordUsage(scope: string, tokens: number, now: number = Date.now()): Promise<void> {
  if (tokenBudget() <= 0 || tokens <= 0) return;
  const key = budgetKey(scope, now);
  const used = Number((await sharedKv.get(key)) ?? 0);
  await sharedKv.set(key, String(used + tokens), { ttlMs: windowMs() * 2 });
}

export interface AiGovContext { scope?: string | undefined; role?: string | undefined }

export interface AiGovernanceStatus {
  dlp: boolean;
  modelAllowlist: Record<string, string[] | "*"> | null;
  budget: { limit: number; windowHours: number };
}

/** Admin status of the AI-governance policy (no secrets). */
export function aiGovernanceStatus(): AiGovernanceStatus {
  const list = modelAllowlist();
  return {
    dlp: dlpEnabled(),
    modelAllowlist: list ? Object.fromEntries([...list].map(([r, v]) => [r, v === "*" ? "*" : [...v]])) : null,
    budget: { limit: tokenBudget(), windowHours: windowMs() / (60 * 60 * 1000) },
  };
}

/** Per-scope token usage in the current window (for the chargeback/usage report). */
export async function aiUsageReport(now: number = Date.now()): Promise<{ scope: string; tokens: number }[]> {
  const bucket = Math.floor(now / windowMs());
  const entries = await sharedKv.list("ai:bud:");
  const suffix = `:${bucket}`;
  return entries
    .filter((e) => e.key.endsWith(suffix))
    .map((e) => ({ scope: e.key.slice("ai:bud:".length, -suffix.length), tokens: Number(e.value) }))
    .sort((a, b) => b.tokens - a.tokens);
}
