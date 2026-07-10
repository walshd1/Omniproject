import { describe, it, expect } from "vitest";
import {
  canPassGate,
  criteriaMet,
  decideGate,
  gateProgress,
  goApprovals,
  initialGateState,
  StageGateError,
  type Approval,
  type Lifecycle,
} from "./stage-gate";

const lifecycle: Lifecycle = [
  { id: "g1", name: "Idea", criteria: [{ id: "c1", label: "Business case" }], minApprovals: 1 },
  { id: "g2", name: "Plan", criteria: [{ id: "c2", label: "Plan approved" }, { id: "c3", label: "Budget set" }], minApprovals: 2 },
];

const go = (by: string): Approval => ({ by, verdict: "go" });

describe("stage-gate guards", () => {
  it("criteriaMet requires every criterion", () => {
    expect(criteriaMet(lifecycle[1]!, ["c2"])).toBe(false);
    expect(criteriaMet(lifecycle[1]!, ["c2", "c3"])).toBe(true);
  });

  it("goApprovals counts distinct reviewers only", () => {
    expect(goApprovals([go("a"), go("a"), go("b")])).toBe(2);
    expect(goApprovals([{ by: "a", verdict: "hold" }, go("b")])).toBe(1);
  });

  it("canPassGate needs criteria AND the approval threshold", () => {
    expect(canPassGate(lifecycle[1]!, ["c2", "c3"], [go("a")])).toBe(false); // needs 2 approvals
    expect(canPassGate(lifecycle[1]!, ["c2", "c3"], [go("a"), go("b")])).toBe(true);
    expect(canPassGate(lifecycle[1]!, ["c2"], [go("a"), go("b")])).toBe(false); // criterion missing
  });
});

describe("decideGate", () => {
  it("advances on a valid go and completes after the last gate", () => {
    let s = initialGateState();
    s = decideGate(s, lifecycle, { by: "sponsor", verdict: "go", at: "t1", metCriterionIds: ["c1"], approvals: [go("sponsor")] });
    expect(s.currentGateIndex).toBe(1);
    expect(s.status).toBe("in-progress");
    s = decideGate(s, lifecycle, { by: "board", verdict: "go", at: "t2", metCriterionIds: ["c2", "c3"], approvals: [go("a"), go("b")] });
    expect(s.status).toBe("completed");
    expect(gateProgress(s, lifecycle).passed).toBe(2);
  });

  it("refuses a premature go (criteria unmet or too few approvals)", () => {
    const s = initialGateState();
    expect(() => decideGate(s, lifecycle, { by: "x", verdict: "go", at: "t", metCriterionIds: [], approvals: [go("x")] })).toThrow(StageGateError);
  });

  it("kill is terminal — no further decisions", () => {
    let s = decideGate(initialGateState(), lifecycle, { by: "sponsor", verdict: "kill", at: "t", note: "no case" });
    expect(s.status).toBe("killed");
    expect(() => decideGate(s, lifecycle, { by: "x", verdict: "go", at: "t2" })).toThrow(/killed/);
  });

  it("hold records the decision but keeps the project at the gate", () => {
    const s = decideGate(initialGateState(), lifecycle, { by: "sponsor", verdict: "hold", at: "t", note: "pending legal" });
    expect(s.currentGateIndex).toBe(0);
    expect(s.status).toBe("in-progress");
    expect(s.history.at(-1)).toMatchObject({ verdict: "hold", note: "pending legal" });
  });

  it("gateProgress reports the current gate and passed/total", () => {
    const p = gateProgress(initialGateState(), lifecycle);
    expect(p).toMatchObject({ passed: 0, total: 2, status: "in-progress" });
    expect(p.currentGate?.id).toBe("g1");
  });
});
