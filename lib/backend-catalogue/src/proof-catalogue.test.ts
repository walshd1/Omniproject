import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANNOTATION_TYPES, REGION_ANNOTATION_TYPES, DELIVERABLE_KINDS,
  PROOF_DECISIONS, REVIEW_DECISIONS, PROOF_LIMITS,
} from "./proof-catalogue";

/** The proofing content model — the single source the palette, validator and primitive store draw from. */

test("annotation types are the expected primitive set", () => {
  assert.deepEqual([...ANNOTATION_TYPES], ["pin", "box", "highlight"]);
});

test("region annotation types are a subset of all annotation types (and exclude the point-only pin)", () => {
  for (const t of REGION_ANNOTATION_TYPES) assert.ok(ANNOTATION_TYPES.includes(t));
  assert.ok(!REGION_ANNOTATION_TYPES.includes("pin"));
});

test("deliverable kinds are image + pdf", () => {
  assert.deepEqual([...DELIVERABLE_KINDS], ["image", "pdf"]);
});

test("decisions: pending is the implicit start; review decisions are the settable ones", () => {
  assert.ok(PROOF_DECISIONS.includes("pending"));
  assert.deepEqual([...REVIEW_DECISIONS].sort(), ["approved", "changes-requested", "rejected"]);
  for (const d of REVIEW_DECISIONS) assert.ok(PROOF_DECISIONS.includes(d));
  assert.ok(!REVIEW_DECISIONS.includes("pending"));
});

test("limits are sane bounds", () => {
  assert.ok(PROOF_LIMITS.maxAnnotations > 0);
  assert.ok(PROOF_LIMITS.maxProofBytes > PROOF_LIMITS.maxText);
});
