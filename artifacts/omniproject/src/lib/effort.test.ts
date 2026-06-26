import { describe, it, expect } from "vitest";
import { effortProgress } from "./effort";

describe("effortProgress", () => {
  it("computes percent, bar and variance when both are known", () => {
    const p = effortProgress(40, 26);
    expect(p.pct).toBe(65);
    expect(p.barPct).toBe(65);
    expect(p.band).toBe("under");
    expect(p.variance).toBe(14);
  });

  it("bands near the estimate (90–100%)", () => {
    expect(effortProgress(10, 9).band).toBe("near");
    expect(effortProgress(10, 10).band).toBe("near");
  });

  it("flags an overrun and clamps the bar to 100", () => {
    const p = effortProgress(20, 30);
    expect(p.pct).toBe(150);
    expect(p.barPct).toBe(100); // bar clamped
    expect(p.band).toBe("over");
    expect(p.variance).toBe(-10); // negative ⇒ over by 10h
  });

  it("is unknown without a usable estimate", () => {
    expect(effortProgress(null, 5).band).toBe("unknown");
    expect(effortProgress(0, 5).band).toBe("unknown");
    expect(effortProgress(undefined, undefined).band).toBe("unknown");
  });

  it("treats negative logged as zero", () => {
    expect(effortProgress(10, -4).pct).toBe(0);
  });
});
