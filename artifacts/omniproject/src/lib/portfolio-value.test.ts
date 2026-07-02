import { describe, it, expect } from "vitest";
import { rollupIncome, rollupBenefits, type ProjectItems } from "./portfolio-value";

const RATES = { GBP: 1, USD: 1.25 };

function proj(over: Partial<ProjectItems> = {}): ProjectItems {
  return { projectId: "p", projectName: "P", programmeId: null, programmeName: null, currency: "GBP", items: [], ...over };
}

describe("rollupIncome", () => {
  it("consolidates projected vs invoiced by programme into the reporting currency", () => {
    const { programmes, portfolio } = rollupIncome([
      proj({ projectId: "a", programmeId: "p1", programmeName: "Platform", currency: "GBP", items: [{ id: "1", title: "t", revenue: 1000, invoicedAmount: 400 }] }),
      proj({ projectId: "b", programmeId: "p1", programmeName: "Platform", currency: "USD", items: [{ id: "2", title: "t", revenue: 1250, invoicedAmount: 1250 }] }),
    ], "GBP", RATES);
    // USD 1250 → ×1.25 = 1562.5 projected; GBP 1000 stays
    expect(portfolio.projected).toBeCloseTo(1000 + 1562.5);
    expect(programmes[0]!.key).toBe("p1");
  });

  it("derives unbilled (clamped) and billed %", () => {
    const { portfolio } = rollupIncome([proj({ items: [{ id: "1", title: "t", revenue: 1000, invoicedAmount: 600 }] })], "GBP", RATES);
    expect(portfolio.unbilled).toBe(400);
    expect(portfolio.billedPct).toBe(60);
  });

  it("shows a local figure for a single-currency row, and nulls it once mixed", () => {
    const { programmes, portfolio } = rollupIncome([
      proj({ projectId: "a", programmeId: "eu", programmeName: "EU", currency: "EUR", items: [{ id: "1", title: "t", revenue: 500, invoicedAmount: 200 }] }),
      proj({ projectId: "b", programmeId: "eu", programmeName: "EU", currency: "EUR", items: [{ id: "2", title: "t", revenue: 300, invoicedAmount: 100 }] }),
    ], "GBP", { ...RATES, EUR: 1.1 });
    const eu = programmes.find((p) => p.key === "eu")!;
    expect(eu.localCurrency).toBe("EUR");
    expect(eu.local).toEqual({ projected: 800, invoiced: 300 });
    expect(portfolio.localCurrency).toBe("EUR"); // portfolio also single-currency here
  });
});

describe("rollupBenefits", () => {
  it("consolidates planned vs realised and sorts worst-realisation first", () => {
    const { programmes, portfolio } = rollupBenefits([
      proj({ programmeId: "good", programmeName: "Good", items: [{ id: "1", title: "t", plannedBenefitValue: 100, actualBenefitValue: 90, benefitConfidence: 100 }] }),
      proj({ programmeId: "bad", programmeName: "Bad", items: [{ id: "2", title: "t", plannedBenefitValue: 100, actualBenefitValue: 10, benefitConfidence: 100 }] }),
    ], "GBP", RATES);
    expect(programmes[0]!.key).toBe("bad"); // worst realisation first
    expect(portfolio.planned).toBe(200);
    expect(portfolio.actual).toBe(100);
    expect(portfolio.realisation).toBe(50);
    // Both programmes are GBP-only, so the portfolio's local figure is still available.
    expect(portfolio.localCurrency).toBe("GBP");
    expect(portfolio.local).toEqual({ planned: 200, actual: 100, expected: 200 });
  });

  it("nulls localCurrency/local once a programme mixes currencies", () => {
    const { programmes } = rollupBenefits([
      proj({ projectId: "a", programmeId: "mixed", currency: "GBP", items: [{ id: "1", title: "t", plannedBenefitValue: 100, actualBenefitValue: 50, benefitConfidence: 100 }] }),
      proj({ projectId: "b", programmeId: "mixed", currency: "USD", items: [{ id: "2", title: "t", plannedBenefitValue: 100, actualBenefitValue: 50, benefitConfidence: 100 }] }),
    ], "GBP", RATES);
    const mixed = programmes.find((p) => p.key === "mixed")!;
    expect(mixed.localCurrency).toBeNull();
    expect(mixed.local).toBeNull();
  });
});
