import { useState } from "react";
import { useGetFxRates, getGetFxRatesQueryKey, type FxRates } from "@workspace/api-client-react";

export type { FxRates };

/**
 * Multi-currency rates, read-through from the backend/ERP via the broker.
 * Thin wrapper over the generated `/fx-rates` client so the contract (and its
 * `FxRates` type) stays the single source of truth — no hand-rolled fetch.
 */
export function useFxRates() {
  return useGetFxRates({ query: { queryKey: getGetFxRatesQueryKey(), retry: false, staleTime: 5 * 60_000 } });
}

/** Convert between currencies via a base-anchored rate table. Falls back to the
 *  original amount if a rate is missing (so the UI never shows NaN). */
export function convertAmount(amount: number, from: string, to: string, rates?: Record<string, number>): number {
  if (!rates || from === to) return amount;
  const rFrom = rates[from];
  const rTo = rates[to];
  if (!rFrom || !rTo) return amount;
  return (amount * rFrom) / rTo;
}

export function currencyList(rates?: Record<string, number>): string[] {
  return rates ? Object.keys(rates).sort() : [];
}

/** The first currency seen across a set of items, falling back to a default (e.g. for a report's display). */
export function firstCurrency(items: readonly { currency?: string | null }[] | undefined, fallback = "GBP"): string {
  return (items ?? []).find((i) => i.currency)?.currency || fallback;
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
