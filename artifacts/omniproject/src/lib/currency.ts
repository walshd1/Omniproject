import { useState, useMemo, useCallback } from "react";
import {
  useGetFxRates, getGetFxRatesQueryKey, useGetProjectIssues, getGetProjectIssuesQueryKey,
  type FxRates, type Settings,
} from "@workspace/api-client-react";
import { useT } from "./i18n";
// The pure FX/currency primitives live in @workspace/backend-catalogue (shared with the gateway's
// portfolio-financials consolidation); imported for local use + re-exported so SPA importers keep this path.
import { convertAmount, isConvertible, currencyList, DEFAULT_CURRENCY, LocalTracker } from "@workspace/backend-catalogue";

export type { FxRates };
export { convertAmount, isConvertible, currencyList, DEFAULT_CURRENCY, LocalTracker };

/**
 * Multi-currency rates, read-through from the backend/ERP via the broker. `asOf` (ISO date),
 * when given, implements the FX rate-source + as-of-date policy (period-close / budget rate,
 * see `resolveFxAsOf`) — the broker degrades to its live spot rate if it can't serve history.
 * Thin wrapper over the generated `/fx-rates` client so the contract (and its `FxRates` type)
 * stays the single source of truth — no hand-rolled fetch.
 */
export function useFxRates(asOf?: string) {
  const params = asOf ? { asOf } : undefined;
  return useGetFxRates(params, { query: { queryKey: getGetFxRatesQueryKey(params), retry: false, staleTime: 5 * 60_000 } });
}

/** Resolve the org's FX as-of-date policy (settings.fxRatePolicy) to the `asOf` date `useFxRates`
 *  should request: undefined for "spot" (today's live rate); `settings.fxRateAsOfDate` for
 *  "periodClose"/"budgetRate" (undefined — i.e. falls back to spot — if no date is configured). */
export function resolveFxAsOf(settings: Pick<Settings, "fxRatePolicy" | "fxRateAsOfDate"> | undefined): string | undefined {
  if (!settings || !settings.fxRatePolicy || settings.fxRatePolicy === "spot") return undefined;
  return settings.fxRateAsOfDate || undefined;
}

/** The first currency seen across a set of items, falling back to a default (e.g. for a report's display). */
export function firstCurrency(items: readonly { currency?: string | null }[] | undefined, fallback = DEFAULT_CURRENCY): string {
  return (items ?? []).find((i) => i.currency)?.currency || fallback;
}

/**
 * The shared "fetch a project's issues + derive its display currency + a money formatter" scaffold
 * that every project-scoped financial report repeated verbatim. Returns the issues query (data +
 * loading/error/refetch for `<DataState>`), the derived reporting currency `ccy`, and a `money(n)`
 * formatter bound to it — so a report is just `const { issues, money } = useProjectIssuesMoney(projectId)`.
 */
export function useProjectIssuesMoney(projectId: string) {
  const { formatCurrency } = useT();
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId, {
    query: { queryKey: getGetProjectIssuesQueryKey(projectId) },
  });
  const ccy = useMemo(() => firstCurrency(issues), [issues]);
  const money = useCallback((n: number) => formatCurrency(n, ccy), [formatCurrency, ccy]);
  return { issues, ccy, money, isLoading, isError, error, refetch };
}

/** Display-currency picker state for a financial panel: the operator's chosen display
 *  currency (component-local, defaults to the item's own `native` currency), a `convert`
 *  from native → the chosen display currency, and the sorted currency options (native +
 *  whatever the live FX table lists). Wraps the `useFxRates` + `convertAmount` +
 *  `currencyList` block every financials panel (project strip, programme card, EVM chart)
 *  used to repeat. Call unconditionally, same as any hook. */
export function useDisplayCurrency(native: string) {
  const { data: fx } = useFxRates();
  const [display, setDisplay] = useState("");
  const displayCcy = display || native;
  const convert = (n: number) => convertAmount(n, native, displayCcy, fx?.rates);
  const currencyOptions = Array.from(new Set([native, ...currencyList(fx?.rates)]));
  return { displayCcy, setDisplay, convert, currencyOptions };
}
