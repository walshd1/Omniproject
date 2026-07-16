import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeProofWrite, sanitizeDeliverable, sanitizeAnnotation, ProofError,
  makeProofId, parseProofId, proofScope, newJsonProofRow, mergeJsonProofRow, applyDecision,
  isReviewDecision, proofMeta,
} from "./proof";
import type { ActorContext, Proof } from "../broker/types";
import { PROOF_LIMITS } from "@workspace/backend-catalogue";

/** The proof sanitiser + storage-target helpers — the single choke point every write passes through. */

const DELIVERABLE = { kind: "image" as const, url: "https://cdn.example/x.png" };

test("a proof needs a name and a valid deliverable", () => {
  assert.throws(() => sanitizeProofWrite({ name: "  ", deliverable: DELIVERABLE, annotations: [] }), ProofError);
  assert.throws(() => sanitizeProofWrite({ name: "N", deliverable: { kind: "gif", url: "https://x/y" }, annotations: [] }), ProofError);
  assert.throws(() => sanitizeProofWrite({ name: "N", deliverable: { kind: "image", url: "javascript:alert(1)" }, annotations: [] }), ProofError);
});

test("a deliverable accepts a safe absolute url OR a root-relative attachment ref", () => {
  assert.equal(sanitizeDeliverable({ kind: "pdf", url: "https://x/y.pdf" }).url, "https://x/y.pdf");
  assert.equal(sanitizeDeliverable({ kind: "image", url: "/api/attachments/abc" }).url, "/api/attachments/abc");
  assert.throws(() => sanitizeDeliverable({ kind: "image", url: "//evil.example/x" }), ProofError); // protocol-relative rejected
});

test("annotations are validated by type: coords clamped, regions sized, unknown dropped, extras stripped", () => {
  const pin = sanitizeAnnotation({ id: "p", type: "pin", x: 5, y: -1, text: "hi", onClick: "steal()" }, 0)!;
  assert.equal(pin.x, 1); // clamped to 1
  assert.equal(pin.y, 0); // clamped to 0
  assert.equal("w" in pin, false, "a pin has no region");
  assert.equal("onClick" in pin, false, "smuggled field dropped");
  const box = sanitizeAnnotation({ id: "b", type: "box", x: 0.1, y: 0.1 }, 0)!;
  assert.ok(box.w! > 0 && box.h! > 0, "a box gets a default region");
  assert.equal(sanitizeAnnotation({ type: "doodle" }, 0), null, "unknown type dropped");
});

test("too many annotations is rejected", () => {
  const many = Array.from({ length: PROOF_LIMITS.maxAnnotations + 1 }, (_, i) => ({ id: `a${i}`, type: "pin", x: 0, y: 0 }));
  assert.throws(() => sanitizeProofWrite({ name: "N", deliverable: DELIVERABLE, annotations: many }), ProofError);
});

test("storage defaults to the private user area; a project target needs a projectId", () => {
  assert.equal(sanitizeProofWrite({ name: "N", deliverable: DELIVERABLE, annotations: [] }).storage, "user");
  assert.equal(sanitizeProofWrite({ name: "N", storage: "org", deliverable: DELIVERABLE, annotations: [] }).storage, "org");
  assert.equal(sanitizeProofWrite({ name: "N", storage: "sidecar", deliverable: DELIVERABLE, annotations: [] }).storage, "user"); // no sidecar → default
  assert.throws(() => sanitizeProofWrite({ name: "N", storage: "project", deliverable: DELIVERABLE, annotations: [] }), ProofError);
});

test("ids are self-describing and round-trip; a user scope always uses the caller's own sub", () => {
  assert.equal(makeProofId("user", "abc"), "user~abc");
  assert.deepEqual(parseProofId("project~p1~u"), { storage: "project", projectId: "p1", localId: "u" });
  assert.equal(parseProofId("sidecar~x"), null, "sidecar is not a proof target");
  assert.deepEqual(proofScope(parseProofId("user~someoneElse")!, "me"), { kind: "user", sub: "me" });
});

test("newJsonProofRow starts at v1/pending; mergeJsonProofRow re-opens the decision only on a new deliverable", () => {
  const ctx: ActorContext = { sub: "owner", email: "o@x.io" };
  const input = sanitizeProofWrite({ name: "P", deliverable: DELIVERABLE, annotations: [] });
  const row = newJsonProofRow("user~1", input, ctx, "t0");
  assert.equal(row.version, 1);
  assert.equal(row.decision, "pending");
  assert.equal(row.ownerSub, "owner");

  const decided = applyDecision(row, "approved", { sub: "reviewer", email: "r@x.io" }, "t1");
  assert.equal(decided.decision, "approved");
  assert.equal(decided.decisionVersion, 1);
  assert.equal(decided.decidedBy, "r@x.io");

  // Same deliverable → decision preserved, version steady.
  const sameDeliverable = mergeJsonProofRow(decided, sanitizeProofWrite({ name: "P2", deliverable: DELIVERABLE, annotations: [] }), ctx, "t2");
  assert.equal(sameDeliverable.version, 1);
  assert.equal(sameDeliverable.decision, "approved", "an edit that keeps the deliverable keeps the decision");

  // New deliverable → version bumps, decision re-opens.
  const newDeliverable = mergeJsonProofRow(decided, sanitizeProofWrite({ name: "P3", deliverable: { kind: "image", url: "https://cdn.example/v2.png" }, annotations: [] }), ctx, "t3");
  assert.equal(newDeliverable.version, 2);
  assert.equal(newDeliverable.decision, "pending");
  assert.equal(newDeliverable.decidedBy, null);
});

test("isReviewDecision only accepts a reviewer's choices; proofMeta drops the bodies", () => {
  assert.ok(isReviewDecision("approved"));
  assert.ok(!isReviewDecision("pending"));
  assert.ok(!isReviewDecision("nope"));
  const proof: Proof = { id: "org~1", name: "P", storage: "org", deliverable: DELIVERABLE, version: 1, annotations: [{ id: "a", type: "pin", x: 0, y: 0 }], decision: "approved", updatedAt: "t" };
  const meta = proofMeta(proof);
  assert.equal("deliverable" in meta, false);
  assert.equal("annotations" in meta, false);
  assert.equal(meta.decision, "approved");
});
