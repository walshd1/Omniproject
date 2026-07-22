import { describe, it, expect } from "vitest";
import { rollupBySpec, type ProjectItems } from "./portfolio-value";

const RATES = { GBP: 1, USD: 1.25 };

function proj(over: Partial<ProjectItems> = {}): ProjectItems {
  return { projectId: "p", projectName: "P", programmeId: null, programmeName: null, currency: "GBP", items: [], ...over };
}

describe("rollupIncome", () => {
  it("consolidates projected vs invoiced by programme into the reporting currency", () => {
    const { programmes, portfolio } = rollupBySpec("income", [
      proj({ projectId: "a", programmeId: "p1", programmeName: "Platform", currency: "GBP", items: [{ id: "1", title: "t", revenue: 1000, invoicedAmount: 400 }] }),
      proj({ projectId: "b", programmeId: "p1", programmeName: "Platform", currency: "USD", items: [{ id: "2", title: "t", revenue: 1250, invoicedAmount: 1250 }] }),
    ], "GBP", RATES);
    // USD 1250 → ×1.25 = 1562.5 projected; GBP 1000 stays
    expect(portfolio.metrics["projected"]).toBeCloseTo(1000 + 1562.5);
    expect(programmes[0]!.key).toBe("p1");
  });

  it("derives unbilled (clamped) and billed %", () => {
    const { portfolio } = rollupBySpec("income", [proj({ items: [{ id: "1", title: "t", revenue: 1000, invoicedAmount: 600 }] })], "GBP", RATES);
    expect(portfolio.metrics["unbilled"]).toBe(400);
    expect(portfolio.metrics["billedPct"]).toBe(60);
  });

  it("shows a local figure for a single-currency row, and nulls it once mixed", () => {
    const { programmes, portfolio } = rollupBySpec("income", [
      proj({ projectId: "a", programmeId: "eu", programmeName: "EU", currency: "EUR", items: [{ id: "1", title: "t", revenue: 500, invoicedAmount: 200 }] }),
      proj({ projectId: "b", programmeId: "eu", programmeName: "EU", currency: "EUR", items: [{ id: "2", title: "t", revenue: 300, invoicedAmount: 100 }] }),
    ], "GBP", { ...RATES, EUR: 1.1 });
    const eu = programmes.find((p) => p.key === "eu")!;
    expect(eu.localCurrency).toBe("EUR");
    expect(eu.local).toEqual({ projected: 800, invoiced: 300 });
    expect(portfolio.localCurrency).toBe("EUR"); // portfolio also single-currency here
  });

  it("EXCLUDES an FX-unconvertible row from the consolidated total (not add its raw foreign amount)", () => {
    // JPY has no rate to GBP → its raw amount must NOT be summed into the GBP total (that would
    // overstate it by 500000). The convertible GBP row stands alone; the JPY row is counted excluded.
    const { portfolio } = rollupBySpec("income", [
      proj({ projectId: "a", currency: "GBP", items: [{ id: "1", title: "t", revenue: 1000, invoicedAmount: 400 }] }),
      proj({ projectId: "b", currency: "JPY", items: [{ id: "2", title: "t", revenue: 500000, invoicedAmount: 250000 }] }),
    ], "GBP", RATES);
    expect(portfolio.metrics["projected"]).toBe(1000); // JPY 500000 dropped, not added raw
    expect(portfolio.metrics["invoiced"]).toBe(400);
    expect(portfolio.projects).toBe(2);
    expect(portfolio.excludedForFx).toBe(1);
  });
});

describe("scope — same consolidation, different grouping of the data", () => {
  const projects = [
    proj({ projectId: "a", programmeId: "p1", programmeName: "Platform", items: [{ id: "1", title: "t", budget: 1000, actualCost: 400 }] }),
    proj({ projectId: "b", programmeId: "p1", programmeName: "Platform", items: [{ id: "2", title: "t", budget: 500, actualCost: 500 }] }),
    proj({ projectId: "c", programmeId: "p2", programmeName: "Mobile", items: [{ id: "3", title: "t", budget: 800, actualCost: 300 }] }),
  ];

  it("groups costs by project, programme or org from the one call", () => {
    const byProject = rollupBySpec("costs", projects, "GBP", RATES, "project");
    expect(byProject.programmes.map((r) => r.key).sort()).toEqual(["a", "b", "c"]);

    const byProgramme = rollupBySpec("costs", projects, "GBP", RATES, "programme");
    expect(byProgramme.programmes.map((r) => r.key).sort()).toEqual(["p1", "p2"]);

    const byOrg = rollupBySpec("costs", projects, "GBP", RATES, "org");
    expect(byOrg.programmes.map((r) => r.key)).toEqual(["__org__"]);
    // the single org group equals the grand total.
    expect(byOrg.programmes[0]!.metrics["budget"]).toBe(2300);
    expect(byOrg.portfolio.metrics["budget"]).toBe(2300);
    expect(byOrg.portfolio.metrics["variance"]).toBe(2300 - 1200);
  });
});

describe("rollupBenefits", () => {
  it("consolidates planned vs realised and sorts worst-realisation first", () => {
    const { programmes, portfolio } = rollupBySpec("benefits", [
      proj({ programmeId: "good", programmeName: "Good", items: [{ id: "1", title: "t", plannedBenefitValue: 100, actualBenefitValue: 90, benefitConfidence: 100 }] }),
      proj({ programmeId: "bad", programmeName: "Bad", items: [{ id: "2", title: "t", plannedBenefitValue: 100, actualBenefitValue: 10, benefitConfidence: 100 }] }),
    ], "GBP", RATES);
    expect(programmes[0]!.key).toBe("bad"); // worst realisation first
    expect(portfolio.metrics["planned"]).toBe(200);
    expect(portfolio.metrics["actual"]).toBe(100);
    expect(portfolio.metrics["realisation"]).toBe(50);
    // Both programmes are GBP-only, so the portfolio's local figure is still available.
    expect(portfolio.localCurrency).toBe("GBP");
    expect(portfolio.local).toEqual({ planned: 200, actual: 100, expected: 200 });
  });

  it("nulls localCurrency/local once a programme mixes currencies", () => {
    const { programmes } = rollupBySpec("benefits", [
      proj({ projectId: "a", programmeId: "mixed", currency: "GBP", items: [{ id: "1", title: "t", plannedBenefitValue: 100, actualBenefitValue: 50, benefitConfidence: 100 }] }),
      proj({ projectId: "b", programmeId: "mixed", currency: "USD", items: [{ id: "2", title: "t", plannedBenefitValue: 100, actualBenefitValue: 50, benefitConfidence: 100 }] }),
    ], "GBP", RATES);
    const mixed = programmes.find((p) => p.key === "mixed")!;
    expect(mixed.localCurrency).toBeNull();
    expect(mixed.local).toBeNull();
  });

  it("EXCLUDES an FX-unconvertible benefit row from the consolidated total", () => {
    const { portfolio } = rollupBySpec("benefits", [
      proj({ projectId: "a", currency: "GBP", items: [{ id: "1", title: "t", plannedBenefitValue: 100, actualBenefitValue: 40, benefitConfidence: 100 }] }),
      proj({ projectId: "b", currency: "JPY", items: [{ id: "2", title: "t", plannedBenefitValue: 900000, actualBenefitValue: 900000, benefitConfidence: 100 }] }),
    ], "GBP", RATES);
    expect(portfolio.metrics["planned"]).toBe(100); // JPY 900000 dropped, not added raw
    expect(portfolio.metrics["actual"]).toBe(40);
    expect(portfolio.excludedForFx).toBe(1);
  });
});
