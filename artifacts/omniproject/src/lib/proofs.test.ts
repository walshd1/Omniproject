import { describe, it, expect } from "vitest";
import { proofRoomId, proofsKey, proofKey } from "./proofs";

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
});
