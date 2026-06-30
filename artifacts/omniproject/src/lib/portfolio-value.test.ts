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
  });
});
