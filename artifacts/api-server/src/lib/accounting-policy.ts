import { DEFAULT_DECLINING_BALANCE_FACTOR, type DepreciationMethod, type DepreciationAccounts, type DisposalAccounts } from "@workspace/backend-catalogue";

/**
 * ACCOUNTING POLICY — the org-set finance variables the ledger postings read: the chart-of-accounts code map plus
 * the depreciation policy (declining-balance factor + default method). This is CONFIG (values an org sets), not a
 * block/warn RULE — but it is finance GOVERNANCE, so it rides the SAME surface as the business ruleset: it is the
 * org baseline in `ruleset.ts`, scope-overridden through `resolveEffectiveRuleset`, and administered under
 * `/admin/ruleset/*`. This module is the pure type + validation + fold layer the ruleset governance composes.
 *
 * MERGE SEMANTICS differ from the rule modes: modes/field-rules TIGHTEN-only (a lower scope can only harden a
 * gate), but accounting values plain-OVERRIDE (a nearer scope replaces a code / the factor). {@link foldAccounting}
 * is that override fold; the ruleset scope resolver applies it to the accounting facet while tightening the rest.
 */

export type { DepreciationMethod };

/** The GL account codes a finance posting maps its concepts onto — the org's chart-of-accounts mapping. Empty by
 *  default (an org authors its own codes); each validated as an id-safe token. */
export interface AccountingAccounts {
  /** Depreciation-expense account (debited by a depreciation run). */
  depreciationExpense: string;
  /** Accumulated-depreciation contra-asset account (credited by a run, debited on disposal). */
  accumulatedDepreciation: string;
  /** Fixed-asset cost account (credited on disposal to remove the asset). */
  assetCost: string;
  /** Cash/receivable account disposal proceeds land in (debited on disposal). */
  disposalProceeds: string;
  /** Gain-or-loss-on-disposal account. */
  gainLossOnDisposal: string;
}

/** Org ACCOUNTING POLICY — the finance variables the engines read. Governed as part of the business ruleset. */
export interface AccountingConfig {
  /** Chart-of-accounts code mapping. */
  accounts: AccountingAccounts;
  /** Declining-balance multiplier (2 = double-declining / 200%, 1.5 = 150% DB). */
  decliningBalanceFactor: number;
  /** The depreciation method applied when an asset record does not specify one. */
  defaultDepreciationMethod: DepreciationMethod;
}

/** A PARTIAL accounting override — any subset of the codes/policy a scope (or an admin edit) supplies. */
export interface AccountingOverride {
  accounts?: Partial<AccountingAccounts>;
  decliningBalanceFactor?: number;
  defaultDepreciationMethod?: DepreciationMethod;
}

export const ACCOUNT_KEYS: (keyof AccountingAccounts)[] = ["depreciationExpense", "accumulatedDepreciation", "assetCost", "disposalProceeds", "gainLossOnDisposal"];

export const DEFAULT_ACCOUNTING: AccountingConfig = {
  accounts: { depreciationExpense: "", accumulatedDepreciation: "", assetCost: "", disposalProceeds: "", gainLossOnDisposal: "" },
  decliningBalanceFactor: DEFAULT_DECLINING_BALANCE_FACTOR,
  defaultDepreciationMethod: "straight_line",
};

const ACCOUNT_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; // an id-safe GL code (empty "" = unset)
const DEPRECIATION_METHODS: ReadonlySet<string> = new Set<DepreciationMethod>(["straight_line", "declining_balance", "units_of_production", "sum_of_years_digits"]);

/**
 * Validate + normalise a partial accounting `values` payload (the admin's edit) into a clean PARTIAL: account
 * codes are id-safe tokens (or "" to unset), the DB factor is in [1, 4], the default method is one of the four.
 * Throws {@link Error} on an invalid value. Returns only the keys present (a partial layer to fold).
 */
export function sanitizeAccountingValues(raw: unknown): AccountingOverride {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("accounting values must be an object");
  const r = raw as Record<string, unknown>;
  const out: AccountingOverride = {};
  if (r["accounts"] !== undefined) {
    const a = r["accounts"];
    if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error("accounting.accounts must be an object");
    const acc: Partial<AccountingAccounts> = {};
    for (const k of ACCOUNT_KEYS) {
      const v = (a as Record<string, unknown>)[k];
      if (v === undefined) continue;
      if (typeof v !== "string") throw new Error(`accounting.accounts.${k} must be a string`);
      const code = v.trim();
      if (code !== "" && !ACCOUNT_CODE.test(code)) throw new Error(`accounting.accounts.${k} must be an id-safe account code`);
      acc[k] = code;
    }
    out.accounts = acc; // a partial map; foldAccounting merges it over the base
  }
  if (r["decliningBalanceFactor"] !== undefined) {
    const f = r["decliningBalanceFactor"];
    if (typeof f !== "number" || !Number.isFinite(f) || f < 1 || f > 4) throw new Error("accounting.decliningBalanceFactor must be a number in [1, 4]");
    out.decliningBalanceFactor = f;
  }
  if (r["defaultDepreciationMethod"] !== undefined) {
    const m = r["defaultDepreciationMethod"];
    if (typeof m !== "string" || !DEPRECIATION_METHODS.has(m)) throw new Error("accounting.defaultDepreciationMethod must be a valid depreciation method");
    out.defaultDepreciationMethod = m as DepreciationMethod;
  }
  return out;
}

/**
 * Fold a partial accounting OVERRIDE onto a base, OVERRIDE-style (nearest wins): each supplied account code
 * replaces the base's, the factor/method replace when present. (Unlike rule modes, which only tighten — an
 * account code has no "stricter".) Absent keys inherit the base unchanged. Pure.
 */
export function foldAccounting(base: AccountingConfig, override: AccountingOverride | undefined): AccountingConfig {
  if (!override) return { ...base, accounts: { ...base.accounts } };
  return {
    accounts: { ...base.accounts, ...(override.accounts ?? {}) },
    decliningBalanceFactor: override.decliningBalanceFactor ?? base.decliningBalanceFactor,
    defaultDepreciationMethod: override.defaultDepreciationMethod ?? base.defaultDepreciationMethod,
  };
}

/** Map the resolved accounting config to the depreciation engine's period-run account params. */
export function depreciationAccounts(cfg: AccountingConfig): DepreciationAccounts {
  return { expenseAccount: cfg.accounts.depreciationExpense, accumulatedAccount: cfg.accounts.accumulatedDepreciation };
}

/** Map the resolved accounting config to the depreciation engine's disposal account params. */
export function disposalAccounts(cfg: AccountingConfig): DisposalAccounts {
  return {
    assetAccount: cfg.accounts.assetCost,
    accumulatedAccount: cfg.accounts.accumulatedDepreciation,
    proceedsAccount: cfg.accounts.disposalProceeds,
    gainLossAccount: cfg.accounts.gainLossOnDisposal,
  };
}

/** The GL account codes still blank in a resolved config — the ones an org must set before a depreciation or
 *  disposal posting can run. Empty array ⇒ the chart-of-accounts mapping is complete. */
export function missingAccountingAccounts(cfg: AccountingConfig): (keyof AccountingAccounts)[] {
  return ACCOUNT_KEYS.filter((k) => !cfg.accounts[k]);
}
