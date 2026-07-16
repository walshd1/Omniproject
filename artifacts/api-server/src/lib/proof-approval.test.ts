import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod"; // lets the sealed store derive a key

let dir: string;
let approval: typeof import("./proof-approval");
let store: typeof import("./artifact-store");
import type { Proof } from "../broker/types";

/** The proof-decision approval executor — applies a HELD decision when the chain signs off, detached from a
 *  request, and refuses to land on a proof that was deleted or whose version moved on since the proposal. */
before(async () => { approval = await import("./proof-approval"); store = await import("./artifact-store"); });
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-approval-"));
  process.env["OMNI_CONFIG_DIR"] = dir;
});
after(() => { delete process.env["OMNI_CONFIG_DIR"]; });

const SCOPE = { kind: "user" as const, sub: "rev" };
function seedProof(version = 1): Proof {
  const p: Proof = {
    id: "user~p1", name: "Flyer", storage: "user", deliverable: { kind: "image", url: "https://cdn.example/v.png" },
    version, annotations: [], decision: "pending", decidedBy: null, decidedAt: null, updatedAt: "t0",
  };
  store.putArtifact("proof", SCOPE, p);
  return p;
}

test("applies the held decision to the proof, stamping the reviewer label + version", () => {
  seedProof(1);
  approval.applyProofDecisionParams({ proofId: "user~p1", scope: SCOPE, decision: "approved", version: 1, by: "rev@x.io" });
  const after = store.getArtifact<Proof>("proof", SCOPE, "user~p1")!;
  assert.equal(after.decision, "approved");
  assert.equal(after.decisionVersion, 1);
  assert.equal(after.decidedBy, "rev@x.io");
});

test("a stale sign-off (version moved on) is a NO-OP — it can't land on newer artwork", () => {
  seedProof(2); // a new deliverable bumped the proof to v2 since the proposal (raised at v1)
  approval.applyProofDecisionParams({ proofId: "user~p1", scope: SCOPE, decision: "approved", version: 1, by: "rev@x.io" });
  assert.equal(store.getArtifact<Proof>("proof", SCOPE, "user~p1")!.decision, "pending", "stale approval did not apply");
});

test("a decision for a deleted proof is a NO-OP (no throw)", () => {
  approval.applyProofDecisionParams({ proofId: "user~gone", scope: SCOPE, decision: "rejected", version: 1, by: "rev@x.io" });
  assert.equal(store.getArtifact<Proof>("proof", SCOPE, "user~gone"), null);
});

test("a malformed params payload is ignored", () => {
  approval.applyProofDecisionParams(null);
  approval.applyProofDecisionParams({ decision: "approved" }); // no proofId/scope
});
