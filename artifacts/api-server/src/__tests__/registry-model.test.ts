import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeRegistrySubmit, newRegistryItem, reviewRegistryItem, releaseRegistryItem, retractRegistryItem,
  registryItemMeta, RegistryError, REGISTRY_LIMITS,
} from "../lib/registry";
import type { ActorContext } from "../broker/types";

/**
 * The org-registry pure model — sanitiser choke point + the draft → review → release → retract lifecycle.
 * Identity, review and release facts are stamped server-side; a registry item is a pure-JSON building block.
 */

const CTX: ActorContext = { sub: "u1", name: "Ada", email: "ada@x.io" };
const NOW = "2026-07-16T00:00:00.000Z";
const GOOD = { kind: "report", name: "Burn rate", publisher: "Acme", version: "2.1.0", payload: { id: "burn-rate", engine: "custom" }, tags: ["finance", "finance", "kpi"] };

test("sanitizeRegistrySubmit accepts a well-formed submission and dedupes tags", () => {
  const s = sanitizeRegistrySubmit(GOOD);
  assert.equal(s.kind, "report");
  assert.equal(s.name, "Burn rate");
  assert.equal(s.version, "2.1.0");
  assert.deepEqual(s.tags, ["finance", "kpi"]);
  assert.deepEqual(s.payload, { id: "burn-rate", engine: "custom" });
});

test("sanitizeRegistrySubmit defaults version, nulls empty description", () => {
  const s = sanitizeRegistrySubmit({ ...GOOD, version: "  ", description: "   " });
  assert.equal(s.version, "1.0.0");
  assert.equal(s.description, null);
});

test("sanitizeRegistrySubmit rejects bad kind, missing name/publisher, non-object payload, oversize payload", () => {
  assert.throws(() => sanitizeRegistrySubmit({ ...GOOD, kind: "nope" }), RegistryError);
  assert.throws(() => sanitizeRegistrySubmit({ ...GOOD, name: "  " }), RegistryError);
  assert.throws(() => sanitizeRegistrySubmit({ ...GOOD, publisher: "" }), RegistryError);
  assert.throws(() => sanitizeRegistrySubmit({ ...GOOD, payload: "not-json" }), RegistryError);
  assert.throws(() => sanitizeRegistrySubmit({ ...GOOD, payload: null }), RegistryError);
  const huge = { blob: "x".repeat(REGISTRY_LIMITS.maxPayloadBytes + 10) };
  assert.throws(() => sanitizeRegistrySubmit({ ...GOOD, payload: huge }), RegistryError);
});

test("a new item is a draft, internal, stamped from ctx", () => {
  const item = newRegistryItem("id-1", sanitizeRegistrySubmit(GOOD), CTX, NOW);
  assert.equal(item.approvalStatus, "draft");
  assert.equal(item.visibility, "internal");
  assert.equal(item.submittedBy, "ada@x.io");
  assert.equal(item.submittedAt, NOW);
  assert.equal(item.reviewedBy, null);
  assert.equal(item.releasedAt, null);
  assert.equal(item.rowVersion, 1);
});

test("approve → release → retract transitions bump rowVersion and flip visibility", () => {
  const draft = newRegistryItem("id-1", sanitizeRegistrySubmit(GOOD), CTX, NOW);

  const approved = reviewRegistryItem(draft, "approved", { sub: "admin", email: "boss@x.io" }, "looks good", "2026-07-16T01:00:00.000Z");
  assert.equal(approved.approvalStatus, "approved");
  assert.equal(approved.reviewedBy, "boss@x.io");
  assert.equal(approved.reviewNote, "looks good");
  assert.equal(approved.visibility, "internal");
  assert.equal(approved.rowVersion, 2);

  const released = releaseRegistryItem(approved, "hub-42", "2026-07-16T02:00:00.000Z");
  assert.equal(released.visibility, "community");
  assert.equal(released.communityRef, "hub-42");
  assert.equal(released.releasedAt, "2026-07-16T02:00:00.000Z");
  assert.equal(released.rowVersion, 3);

  const retracted = retractRegistryItem(released, "2026-07-16T03:00:00.000Z");
  assert.equal(retracted.visibility, "internal");
  assert.equal(retracted.communityRef, null);
  assert.equal(retracted.releasedAt, null);
  assert.equal(retracted.rowVersion, 4);
});

test("rejecting a released item retracts it from the community", () => {
  const draft = newRegistryItem("id-1", sanitizeRegistrySubmit(GOOD), CTX, NOW);
  const approved = reviewRegistryItem(draft, "approved", CTX, null, NOW);
  const released = releaseRegistryItem(approved, "hub-1", NOW);
  const rejected = reviewRegistryItem(released, "rejected", CTX, "pulled", NOW);
  assert.equal(rejected.approvalStatus, "rejected");
  assert.equal(rejected.visibility, "internal");
  assert.equal(rejected.releasedAt, null);
  assert.equal(rejected.communityRef, null);
});

test("registryItemMeta drops the payload", () => {
  const item = newRegistryItem("id-1", sanitizeRegistrySubmit(GOOD), CTX, NOW);
  const meta = registryItemMeta(item);
  assert.equal((meta as { payload?: unknown }).payload, undefined);
  assert.equal(meta.id, "id-1");
  assert.equal(meta.kind, "report");
  assert.equal(meta.approvalStatus, "draft");
});
