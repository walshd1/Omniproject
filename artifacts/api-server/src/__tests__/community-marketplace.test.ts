import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCommunityMarketplace, registerCommunityMarketplace, resetCommunityMarketplace,
  type CommunityMarketplace,
} from "../lib/community-marketplace";
import type { RegistryItem } from "../lib/registry";

/**
 * The community-marketplace seam (org registry → optional community release). By default NO online
 * marketplace is connected, so publish is a no-op that reports "not connected" — the registry release still
 * completes locally. A future integration registers a real connector; this proves the seam swaps cleanly.
 */

const ITEM: RegistryItem = {
  id: "r1", kind: "report", name: "Burn rate", publisher: "Acme", version: "1.0.0",
  description: null, tags: [], payload: { id: "burn-rate" },
  approvalStatus: "approved", visibility: "community",
  submittedBy: "ada@x.io", submittedAt: "2026-01-01T00:00:00.000Z",
  reviewedBy: "ada@x.io", reviewedAt: "2026-01-02T00:00:00.000Z", reviewNote: null,
  releasedAt: "2026-01-03T00:00:00.000Z", communityRef: null,
  updatedAt: "2026-01-03T00:00:00.000Z", rowVersion: 3,
};

afterEach(() => resetCommunityMarketplace());

test("the default marketplace is unconfigured and publish is a no-op that never throws", async () => {
  const cm = getCommunityMarketplace();
  assert.equal(cm.configured(), false);
  assert.equal(cm.name(), null);
  const result = await cm.publish(ITEM);
  assert.equal(result.ok, false);
  assert.equal(result.communityRef, undefined);
  assert.match(result.reason ?? "", /no community marketplace is connected/);
});

test("a registered connector takes over, and reset restores the default", async () => {
  const fake: CommunityMarketplace = {
    configured: () => true,
    name: () => "Acme Community Hub",
    publish: async (it) => ({ ok: true, communityRef: `hub-${it.id}` }),
  };
  registerCommunityMarketplace(fake);
  const cm = getCommunityMarketplace();
  assert.equal(cm.configured(), true);
  assert.equal(cm.name(), "Acme Community Hub");
  assert.deepEqual(await cm.publish(ITEM), { ok: true, communityRef: "hub-r1" });

  resetCommunityMarketplace();
  assert.equal(getCommunityMarketplace().configured(), false);
});
