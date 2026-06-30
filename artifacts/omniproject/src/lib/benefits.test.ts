import { describe, it, expect } from "vitest";
import { summariseBenefits, benefitBucket, isBenefit, type BenefitInput } from "./benefits";

const items: BenefitInput[] = [
  { id: "a", title: "Auth", plannedBenefitValue: 120000, actualBenefitValue: 42000, benefitStatus: "on_track", benefitConfidence: 70 },
  { id: "b", title: "Sync", plannedBenefitValue: 60000, actualBenefitValue: 8000, benefitStatus: "at risk", benefitConfidence: 45 },
  { id: "c", title: "UX", plannedBenefitValue: 50000, actualBenefitValue: 52000, benefitStatus: "realised" },
  { id: "n", title: "No benefit", plannedBenefitValue: 0 }, // excluded
];

describe("benefitBucket", () => {
  it("normalises free-form status into canonical RAG buckets", () => {
    expect(benefitBucket("On Track")).toBe("on_track");
    expect(benefitBucket("at risk")).toBe("at_risk");
    expect(benefitBucket("Realised")).toBe("realised");
    expect(benefitBucket("missed")).toBe("missed");
    expect(benefitBucket(null)).toBe("not_started");
    expect(benefitBucket("something else")).toBe("not_started");
  });
});

describe("isBenefit", () => {
  it("counts an item only when it has a planned/actual value or a status", () => {
    expect(isBenefit({ id: "x", title: "x", plannedBenefitValue: 100 })).toBe(true);
    expect(isBenefit({ id: "x", title: "x", actualBenefitValue: 5 })).toBe(true);
    expect(isBenefit({ id: "x", title: "x", benefitStatus: "on_track" })).toBe(true);
    expect(isBenefit({ id: "x", title: "x" })).toBe(false);
    expect(isBenefit({ id: "x", title: "x", plannedBenefitValue: 0 })).toBe(false);
  });
});

describe("summariseBenefits", () => {
  it("totals planned/actual and computes realisation, excluding non-benefit items", () => {
    const s = summariseBenefits(items);
    expect(s.count).toBe(3); // 'n' excluded
    expect(s.totalPlanned).toBe(230000);
    expect(s.totalActual).toBe(102000);
    expect(s.realisation).toBeCloseTo(102000 / 230000);
  });

  it("counts each item under its status bucket", () => {
    const s = summariseBenefits(items);
    expect(s.byStatus.on_track).toBe(1);
    expect(s.byStatus.at_risk).toBe(1);
    expect(s.byStatus.realised).toBe(1);
    expect(s.byStatus.missed).toBe(0);
  });

  it("risk-adjusts expected value by confidence, defaulting silence to 100%", () => {
    const s = summariseBenefits(items);
    // a: 120000*0.7 + b: 60000*0.45 + c: 50000*1.0 (no confidence ⇒ 100%)
    expect(s.expectedValue).toBeCloseTo(120000 * 0.7 + 60000 * 0.45 + 50000);
  });

  it("orders rows by planned value and carries per-row realisation", () => {
    const s = summariseBenefits(items);
    expect(s.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(s.rows.find((r) => r.id === "c")!.realisation).toBeCloseTo(52000 / 50000);
  });

  it("is safe on an empty / no-benefit set", () => {
    const s = summariseBenefits([{ id: "z", title: "z" }]);
    expect(s.count).toBe(0);
    expect(s.realisation).toBe(0);
    expect(s.expectedValue).toBe(0);
  });
});
