import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * The org ACCOUNTING POLICY — chart-of-accounts codes + depreciation policy — a facet of the business-ruleset
 * governance (NOT a standalone settings key). Read from `GET /api/admin/ruleset/accounting`; written with
 * `PUT /api/admin/ruleset/accounting`. Lives on the same PMO governance surface as the rule modes; it is
 * scope-overridden server-side through the ruleset scope resolver.
 */

export const rulesetAccountingKey = ["ruleset-accounting"] as const;

export const DEPRECIATION_METHODS = ["straight_line", "declining_balance", "units_of_production", "sum_of_years_digits"] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const DEPRECIATION_METHOD_LABELS: Record<DepreciationMethod, string> = {
  straight_line: "Straight line",
  declining_balance: "Declining balance",
  units_of_production: "Units of production",
  sum_of_years_digits: "Sum of years' digits",
};

export interface AccountingAccounts {
  depreciationExpense: string;
  accumulatedDepreciation: string;
  assetCost: string;
  disposalProceeds: string;
  gainLossOnDisposal: string;
}

/** The GL-account fields in display order, with their human labels. */
export const ACCOUNTING_ACCOUNT_FIELDS: { key: keyof AccountingAccounts; label: string }[] = [
  { key: "depreciationExpense", label: "Depreciation expense" },
  { key: "accumulatedDepreciation", label: "Accumulated depreciation" },
  { key: "assetCost", label: "Asset cost" },
  { key: "disposalProceeds", label: "Disposal proceeds" },
  { key: "gainLossOnDisposal", label: "Gain / loss on disposal" },
];

export interface AccountingConfig {
  accounts: AccountingAccounts;
  decliningBalanceFactor: number;
  defaultDepreciationMethod: DepreciationMethod;
}

/** The org-baseline accounting catalogue: the effective policy + which GL codes are still unset. */
export interface AccountingCatalogue {
  accounting: AccountingConfig;
  missingAccounts: (keyof AccountingAccounts)[];
}

/** An id-safe GL account code (or "" to leave a code unset) — mirrors the gateway's validation. */
export const ACCOUNT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const isValidAccountCode = (code: string): boolean => code === "" || ACCOUNT_CODE_PATTERN.test(code);
export const isValidDbFactor = (n: number): boolean => Number.isFinite(n) && n >= 1 && n <= 4;

/** Read the org accounting policy (for a governance admin panel). */
export function useRulesetAccounting() {
  return useQuery({
    queryKey: rulesetAccountingKey,
    queryFn: () => getJson<AccountingCatalogue>("/api/admin/ruleset/accounting"),
    staleTime: 15_000,
  });
}
