import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { ActorContext } from "../broker/types";
import {
  startCanary, acceptCanary, rejectCanary, currentCanary, canaryView, __resetCanary, CANARY_SCHEMA,
} from "./release-canary";
import { approvedPromotion, __resetPromotion, setPromotionRecordedHook } from "./release-promotion";

/**
 * Phase-5 per-org test canary (docs/UPDATE-MECHANISM.md §5). Single-tenant ⇒ one canary at a time: a tagged
 * `testing → accepted|rejected` record, seeded with a sealed data copy, whose acceptance funnels the SAME
 * human-only `release.promote` chain (never a second ungated route to prod).
 */

const SEED = "sha256:deadbeefcafe0123"; // the running/production digest the seed belongs to
const CAND = "sha256:1111222233334444"; // the candidate digest under canary test
const admin = (): ActorContext => ({ sub: "admin-1", actorKind: "human" } as ActorContext);
const now = "2026-07-25T00:00:00.000Z";

let savedManifest: string | undefined;

before(() => {
  savedManifest = process.env["RELEASE_MANIFEST"];
  process.env["RELEASE_MANIFEST"] = JSON.stringify({
    manifest: { version: "1.0.0", gitSha: "abc", builtAt: "2026-01-01T00:00:00.000Z", digest: SEED },
    signature: "not-verified-here",
  });
});
after(() => {
  if (savedManifest === undefined) delete process.env["RELEASE_MANIFEST"]; else process.env["RELEASE_MANIFEST"] = savedManifest;
  setPromotionRecordedHook(null);
});
beforeEach(() => { __resetCanary(); __resetPromotion(); setPromotionRecordedHook(null); });

test("startCanary refuses a non-digest candidate", () => {
  const r = startCanary(admin(), "v2", now);
  assert.equal(r.started, false);
  assert.match(r.reason ?? "", /content digest/);
});

test("startCanary records `testing`, tags the seed digest, and seeds a sealed copy", () => {
  const r = startCanary(admin(), CAND, now);
  assert.equal(r.started, true);
  assert.equal(r.canary?.digest, CAND);
  assert.equal(r.canary?.state, "testing");
  assert.equal(r.canary?.seedDigest, SEED); // the production digest the seed data belonged to
  assert.equal(r.seed?.schema, "omniproject/release-backup");
  assert.equal(currentCanary()?.schema, CANARY_SCHEMA);
});

test("startCanary refuses a second concurrent canary (single-tenant, one at a time)", () => {
  startCanary(admin(), CAND, now);
  const r = startCanary(admin(), "sha256:9999888877776666", now);
  assert.equal(r.started, false);
  assert.match(r.reason ?? "", /already testing/);
});

test("acceptCanary promotes the candidate via the existing release.promote chain (unbound → recorded)", async () => {
  startCanary(admin(), CAND, now);
  assert.equal(approvedPromotion(), null);
  const r = await acceptCanary(admin(), "2026-07-25T01:00:00.000Z");
  assert.equal(r.accepted, true);
  assert.equal(r.promotion?.held, false);
  assert.equal(approvedPromotion()?.digest, CAND); // the SAME promotion path recorded the digest
  assert.equal(currentCanary()?.state, "accepted");
  assert.equal(currentCanary()?.decidedBy, "admin-1");
});

test("acceptCanary is refused when no canary is testing", async () => {
  const r = await acceptCanary(admin(), now);
  assert.equal(r.accepted, false);
  assert.match(r.reason ?? "", /no canary/);
});

test("rejectCanary discards the canary (nothing promoted) and refuses when none is testing", () => {
  assert.equal(rejectCanary(admin(), now).rejected, false); // none testing
  startCanary(admin(), CAND, now);
  const r = rejectCanary(admin(), "2026-07-25T01:00:00.000Z");
  assert.equal(r.rejected, true);
  assert.equal(currentCanary()?.state, "rejected");
  assert.equal(approvedPromotion(), null); // reject promotes nothing
});

test("a new canary can start once the previous one is decided (not `testing`)", () => {
  startCanary(admin(), CAND, now);
  rejectCanary(admin(), now);
  const r = startCanary(admin(), "sha256:aaaabbbbccccdddd", now);
  assert.equal(r.started, true);
  assert.equal(r.canary?.state, "testing");
});

test("canaryView is null with no canary and non-secret when present", () => {
  assert.equal(canaryView(), null);
  startCanary(admin(), CAND, now);
  const v = canaryView();
  assert.deepEqual(Object.keys(v ?? {}).sort(), ["digest", "orgId", "seedDigest", "startedAt", "state"]);
});
