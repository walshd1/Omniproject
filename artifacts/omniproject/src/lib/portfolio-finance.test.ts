import { describe, it, expect } from "vitest";
import type { ProjectFinancials } from "@workspace/api-client-react";
import { consolidateFinancials, type ProjectFin } from "./portfolio-finance";

function fin(over: Partial<ProjectFinancials> = {}): ProjectFinancials {
  return { currency: "GBP", budgetAllocated: 100, actualBurn: 50, earnedValue: 50, cpi: 1, spi: 1, financialHealth: "green", forecastCostAtCompletion: 100, ...over } as ProjectFinancials;
}
function proj(over: Partial<ProjectFin> = {}): ProjectFin {
  return { projectId: "p", projectName: "P", programmeId: null, programmeName: null, fin: fin(), ...over };
}

// base GBP; 1 GBP = 1.25 USD (rates[USD]=1.25, rates[GBP]=1) → convertAmount(x, USD, GBP) = x*1.25/1... per the helper.
const RATES = { GBP: 1, USD: 1.25, EUR: 1.1 };

describe("consolidateFinancials", () => {
  it("converts each project's amounts into the reporting currency and totals them", () => {
    const { portfolio, currencyMix } = consolidateFinancials([
      proj({ projectId: "a", programmeId: "p1", programmeName: "Platform", fin: fin({ currency: "GBP", budgetAllocated: 1000, actualBurn: 400, forecastCostAtCompletion: 1000, earnedValue: 400 }) }),
      proj({ projectId: "b", programmeId: "p1", programmeName: "Platform", fin: fin({ currency: "USD", budgetAllocated: 1250, actualBurn: 1250, forecastCostAtCompletion: 1250, earnedValue: 1000 }) }),
    ], "GBP", RATES);
    // USD 1250 → GBP via the helper (×1.25): contributes 1562.5; GBP 1000 stays.
    expect(portfolio.budget).toBeCloseTo(1000 + 1562.5);
    expect(portfolio.projects).toBe(2);
    expect(currencyMix.map((c) => c.currency).sort()).toEqual(["GBP", "USD"]);
  });

  it("derives variance (budget − forecast) and consolidated CPI (EV ÷ actual)", () => {
    const { portfolio } = consolidateFinancials([
      proj({ fin: fin({ currency: "GBP", budgetAllocated: 1000, actualBurn: 800, forecastCostAtCompletion: 1100, earnedValue: 700 }) }),
    ], "GBP", RATES);
    expect(portfolio.variance).toBeCloseTo(-100); // 1000 − 1100 → projected overspend
    expect(portfolio.cpi).toBeCloseTo(0.88); // 700/800
  });

  it("groups standalone projects and sorts programmes worst-variance first", () => {
    const { programmes } = consolidateFinancials([
      proj({ programmeId: "good", programmeName: "Good", fin: fin({ budgetAllocated: 1000, forecastCostAtCompletion: 900 }) }), // +100
      proj({ programmeId: "bad", programmeName: "Bad", fin: fin({ budgetAllocated: 1000, forecastCostAtCompletion: 1300 }) }), // −300
      proj({ programmeId: null, fin: fin() }),
    ], "GBP", RATES);
    expect(programmes[0]!.key).toBe("bad"); // worst variance first
    expect(programmes.some((p) => p.label === "Standalone")).toBe(true);
  });
});

// ── Local-currency display alongside the consolidated total ──────────────────
describe("consolidateFinancials — localCurrency/local", () => {
  it("shows the un-converted local total when every project in a row shares one currency", () => {
    const { programmes } = consolidateFinancials([
      proj({ projectId: "a", programmeId: "jp", programmeName: "Japan", fin: fin({ currency: "JPY", budgetAllocated: 500, actualBurn: 200, forecastCostAtCompletion: 500, earnedValue: 200 }) }),
      proj({ projectId: "b", programmeId: "jp", programmeName: "Japan", fin: fin({ currency: "JPY", budgetAllocated: 300, actualBurn: 100, forecastCostAtCompletion: 300, earnedValue: 100 }) }),
    ], "GBP", { ...RATES, JPY: 0.005 });
    const jp = programmes.find((p) => p.key === "jp")!;
    expect(jp.localCurrency).toBe("JPY");
    expect(jp.local).toEqual({ budget: 800, actual: 300, forecast: 800, earnedValue: 300 });
    // Consolidated total is still converted into the reporting currency.
    expect(jp.budget).toBeCloseTo(800 * 0.005);
  });

  it("nulls localCurrency/local once a row mixes ≥2 currencies (incl. the portfolio total)", () => {
    const { programmes, portfolio } = consolidateFinancials([
      proj({ projectId: "a", programmeId: "mixed", programmeName: "Mixed", fin: fin({ currency: "GBP", budgetAllocated: 1000 }) }),
      proj({ projectId: "b", programmeId: "mixed", programmeName: "Mixed", fin: fin({ currency: "USD", budgetAllocated: 1000 }) }),
    ], "GBP", RATES);
    const mixed = programmes.find((p) => p.key === "mixed")!;
    expect(mixed.localCurrency).toBeNull();
    expect(mixed.local).toBeNull();
    expect(portfolio.localCurrency).toBeNull();
    expect(portfolio.local).toBeNull();
  });

  it("a single-project Standalone row always has a local figure", () => {
    const { programmes } = consolidateFinancials([
      proj({ projectId: "solo", programmeId: null, fin: fin({ currency: "EUR", budgetAllocated: 250 }) }),
    ], "GBP", RATES);
    const standalone = programmes.find((p) => p.label === "Standalone")!;
    expect(standalone.localCurrency).toBe("EUR");
    expect(standalone.local?.budget).toBe(250);
  });
});

// ── Dirty-data resilience (messy-data generator regression) ──────────────────
describe("consolidateFinancials — dirty amounts", () => {
  it("does not throw and keeps totals finite when amounts arrive as string/null/NaN", () => {
    const { programmes, portfolio } = consolidateFinancials([
      proj({ projectId: "a", fin: fin({ currency: "GBP", budgetAllocated: "1000" as never, actualBurn: null as never, forecastCostAtCompletion: NaN as never, earnedValue: 400 }) }),
      proj({ projectId: "b", fin: fin({ currency: null as never, budgetAllocated: Infinity as never, actualBurn: 100, forecastCostAtCompletion: 200, earnedValue: "abc" as never }) }),
    ], "GBP", RATES);
    for (const r of [...programmes, portfolio]) {
      expect(Number.isFinite(r.budget)).toBe(true);
      expect(Number.isFinite(r.actual)).toBe(true);
      expect(Number.isFinite(r.forecast)).toBe(true);
      expect(Number.isFinite(r.earnedValue)).toBe(true);
      expect(Number.isFinite(r.variance)).toBe(true);
      expect(r.cpi === null || Number.isFinite(r.cpi)).toBe(true);
    }
    // "1000" coerces; null/NaN/Infinity/"abc" collapse to 0.
    expect(portfolio.budget).toBe(1000);
    expect(portfolio.earnedValue).toBe(400);
  });
});
