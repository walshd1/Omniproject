import { describe, it, expect } from "vitest";
import { proofRoomId, proofsKey, proofKey, isProofDecisionHeld, type Proof } from "./proofs";

/** Proofing client helpers — stable query keys + the shared-surface room convention. */
describe("proofs lib", () => {
  it("builds the proof review room id (general + per-annotation)", () => {
    expect(proofRoomId("user~abc")).toBe("proof:user~abc");
    expect(proofRoomId("user~abc", "a1")).toBe("proof:user~abc#a1");
  });

  it("builds stable query keys (scoped + per-proof)", () => {
    expect(proofsKey()).toEqual(["proofs", "all"]);
    expect(proofsKey("p1")).toEqual(["proofs", "p1"]);
    expect(proofKey("org~1")).toEqual(["proof", "org~1"]);
  });

  it("distinguishes a held (sign-off pending) decision response from an applied proof", () => {
    expect(isProofDecisionHeld({ pending: { proposalId: "x", action: "proof.decision" } })).toBe(true);
    const applied = { id: "user~1", name: "P", version: 1, decision: "approved", updatedAt: "" } as unknown as Proof;
    expect(isProofDecisionHeld(applied)).toBe(false);
  });
});
