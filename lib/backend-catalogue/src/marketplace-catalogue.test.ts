import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_CONTRIBUTION_KINDS, EXTENSION_STATUSES, contributionKindLabel } from "./marketplace-catalogue";

/** The marketplace catalogue — the source of truth for the `extensionContribution` primitive family. */

test("the closed sets the primitive family + status draw from", () => {
  assert.deepEqual([...EXTENSION_CONTRIBUTION_KINDS], ["report", "contentPage", "dashboard", "screen"]);
  assert.deepEqual([...EXTENSION_STATUSES], ["installed", "disabled"]);
});

test("contributionKindLabel is human-readable", () => {
  assert.equal(contributionKindLabel("report"), "Report");
  assert.equal(contributionKindLabel("contentPage"), "Content page");
  assert.equal(contributionKindLabel("dashboard"), "Dashboard");
  assert.equal(contributionKindLabel("screen"), "Screen");
});
