import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * The org ACCOUNTING POLICY — the chart-of-accounts code mapping + depreciation policy an org sets, resolved
 * from the scope-layered `accounting` config def (system default < org < programme < project < user). Read from
 * `GET /api/accounting/resolved`; the admin editor seeds from `GET /api/accounting` and writes `PUT /api/accounting`.
 * Not a `/api/settings` slice — like `scheduling`, it lives in the composition model as a scope-layered config def.
 */

export const accountingResolvedKey = ["accounting", "resolved"] as const;
export const accountingOrgKey = ["accounting", "org"] as const;

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

/** The raw shape of a resolved `accounting` config (all optional; validated server-side). */
export interface RawAccountingConfig {
  accounts?: Partial<AccountingAccounts>;
  decliningBalanceFactor?: number;
  defaultDepreciationMethod?: DepreciationMethod;
}

/** An id-safe GL account code (or "" to leave a code unset) — mirrors the gateway's `sanitizeAccountingValues`. */
export const ACCOUNT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const isValidAccountCode = (code: string): boolean => code === "" || ACCOUNT_CODE_PATTERN.test(code);
export const isValidDbFactor = (n: number): boolean => Number.isFinite(n) && n >= 1 && n <= 4;

/** Subscribe to the resolved accounting policy, plus which GL codes are still unset (a posting can't run until
 *  they are). Safe defaults while loading. */
export function useAccountingSettings(): { accounting: RawAccountingConfig; missingAccounts: (keyof AccountingAccounts)[] } {
  const { data } = useQuery({
    queryKey: accountingResolvedKey,
    queryFn: () => getJson<{ accounting: RawAccountingConfig; missingAccounts: (keyof AccountingAccounts)[] }>("/api/accounting/resolved"),
    staleTime: 15_000,
  });
  return { accounting: data?.accounting ?? {}, missingAccounts: data?.missingAccounts ?? [] };
}
