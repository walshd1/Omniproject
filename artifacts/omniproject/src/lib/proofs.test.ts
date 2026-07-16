import { describe, it, expect } from "vitest";
import { proofRoomId, proofsKey, proofKey } from "./proofs";

/** Proofing client helpers — stable query keys + the shared-surface room convention. */
describe("proofs lib", () => {
  it("builds the proof review room id", () => {
    expect(proofRoomId("user~abc")).toBe("proof:user~abc");
  });

  it("builds stable query keys (scoped + per-proof)", () => {
    expect(proofsKey()).toEqual(["proofs", "all"]);
    expect(proofsKey("p1")).toEqual(["proofs", "p1"]);
    expect(proofKey("org~1")).toEqual(["proof", "org~1"]);
  });
});
