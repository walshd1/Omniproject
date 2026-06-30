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
