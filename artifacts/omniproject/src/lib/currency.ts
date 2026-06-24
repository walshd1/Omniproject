import { useQuery } from "@tanstack/react-query";

export interface FxRates {
  base: string;
  rates: Record<string, number>;
  provenance: "sourced" | "sample";
  asOf: string;
}

async function fetchFxRates(): Promise<FxRates> {
  const res = await fetch("/api/fx-rates", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`fx rates failed: ${res.status}`);
  return (await res.json()) as FxRates;
}

/** Multi-currency rates, read-through from the backend/ERP via n8n. */
export function useFxRates() {
  return useQuery({ queryKey: ["fx-rates"], queryFn: fetchFxRates, retry: false, staleTime: 5 * 60_000 });
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
