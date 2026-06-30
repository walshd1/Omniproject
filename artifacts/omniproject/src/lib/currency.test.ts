import { describe, it, expect } from "vitest";
import { convertAmount, currencyList, firstCurrency } from "./currency";

const rates = { GBP: 1, USD: 0.79, EUR: 0.85 };

describe("firstCurrency", () => {
  it("returns the first item's currency, skipping blanks", () => {
    expect(firstCurrency([{ currency: null }, { currency: "EUR" }])).toBe("EUR");
  });
  it("falls back to the default when none is set", () => {
    expect(firstCurrency([{ currency: null }])).toBe("GBP");
    expect(firstCurrency(undefined, "USD")).toBe("USD");
  });
});

describe("convertAmount", () => {
  it("returns the amount unchanged when from === to", () => {
    expect(convertAmount(100, "USD", "USD", rates)).toBe(100);
  });

  it("converts via the base-anchored table", () => {
    // amount(from) → base → to : (100 * 0.79) / 0.85
    expect(convertAmount(100, "USD", "EUR", rates)).toBeCloseTo((100 * 0.79) / 0.85, 6);
  });

  it("falls back to the original amount when rates are missing (never NaN)", () => {
    expect(convertAmount(100, "USD", "EUR", undefined)).toBe(100);
    expect(convertAmount(100, "USD", "ZZZ", rates)).toBe(100);
    expect(Number.isNaN(convertAmount(100, "ZZZ", "USD", rates))).toBe(false);
  });
});

describe("currencyList", () => {
  it("returns a sorted list of currency codes", () => {
    expect(currencyList(rates)).toEqual(["EUR", "GBP", "USD"]);
  });

  it("returns an empty list when rates are absent", () => {
    expect(currencyList(undefined)).toEqual([]);
  });
});
