import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  OMNISTORE_BACKEND, OMNISTORE_HOME, omnistoreEnabled, omnistoreLastResort,
  OMNISTORE_SUPERSET_DOMAINS, omnistoreSupersetCapabilities,
} from "./omnistore-homing";
import { CAPABILITY_DOMAINS } from "./capabilities";
import { BUILTIN_BROKER, SIDECAR_BACKEND } from "./field-target";
import { resolveMappingTargets, planMappingWrite, projectMappingRows, type Mapping } from "./mapping";
import { OmniStore } from "../broker/builtin/omnistore";
import { MemoryStore } from "../broker/builtin/store";
import { BuiltinBroker } from "../broker/builtin/builtin-broker";

/**
 * OmniStore = System-of-Record OF LAST RESORT (homing model, "do a"). Conformance for the two invariants:
 *   1. HOMING — an OTHERWISE-homeless field resolves to the OmniStore home when enabled; an explicit
 *      external home is never overridden; with OmniStore off, orphans stay homeless (a decision).
 *   2. SUPERSET WHEN SOLE — OmniStore homes any orphan, so it offers the full capability superset; a sole
 *      OmniStore backend therefore covers 100% of the data. MemoryStore (ephemeral) does NOT.
 */

// ── The pure model ────────────────────────────────────────────────────────────
test("the last-resort home is the built-in broker over the OmniStore backend", () => {
  assert.deepEqual(OMNISTORE_HOME, { broker: BUILTIN_BROKER, backend: OMNISTORE_BACKEND });
  assert.equal(OMNISTORE_BACKEND, "omnistore");
});

test("omnistoreLastResort gates purely on the enabled flag", () => {
  assert.deepEqual(omnistoreLastResort(true), OMNISTORE_HOME);
  assert.equal(omnistoreLastResort(false), null); // disabled ⇒ no fallback (orphans stay homeless)
});

test("omnistoreEnabled reads the BUILTIN_BROKER env (the same signal the factory switches on)", () => {
  const prev = process.env["BUILTIN_BROKER"];
  try {
    process.env["BUILTIN_BROKER"] = "omnistore";
    assert.equal(omnistoreEnabled(), true);
    process.env["BUILTIN_BROKER"] = "memory";
    assert.equal(omnistoreEnabled(), false);
    delete process.env["BUILTIN_BROKER"];
    assert.equal(omnistoreEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env["BUILTIN_BROKER"]; else process.env["BUILTIN_BROKER"] = prev;
  }
});

test("the OmniStore superset is EVERY gateway capability domain, on — no drift", () => {
  // The below-seam list must stay EXACTLY the gateway's domain set, or a sole OmniStore would silently
  // fail to offer some data it actually homes.
  assert.deepEqual([...OMNISTORE_SUPERSET_DOMAINS].sort(), [...CAPABILITY_DOMAINS].sort());
  const caps = omnistoreSupersetCapabilities();
  for (const d of CAPABILITY_DOMAINS) assert.equal(caps[d], true, `domain ${d} must be on in the superset`);
});

// ── Invariant 1: homing an otherwise-homeless field ─────────────────────────────
const orphanMapping = (): Mapping => ({ id: "custom", fields: { id: "rowId", note: "note" } });

test("HOMING: orphan fields are homeless with OmniStore off, homed with it on", () => {
  const m = orphanMapping();
  // Off: with no declared home, EVERY bare field (id + note) inherits nothing → homeless (the decision).
  assert.deepEqual(resolveMappingTargets(m).homeless.sort(), ["id", "note"]);
  assert.deepEqual((resolveMappingTargets(m, omnistoreLastResort(false) ?? undefined)).homeless.sort(), ["id", "note"]);
  // On: they inherit the OmniStore home → none homeless, and each resolves to the OmniStore backend.
  const homed = resolveMappingTargets(m, OMNISTORE_HOME);
  assert.deepEqual(homed.homeless, []);
  assert.deepEqual(homed.targets["note"], { broker: BUILTIN_BROKER, backend: OMNISTORE_BACKEND, field: "note" });
  assert.deepEqual(homed.targets["id"], { broker: BUILTIN_BROKER, backend: OMNISTORE_BACKEND, field: "rowId" });
});

test("HOMING: an explicit external home is NEVER redirected to OmniStore", () => {
  const m: Mapping = { id: "mixed", fields: { id: "wpId", budget: { broker: "n8n", backend: "sap", field: "ACDOCA" }, note: "note" } };
  const { targets, homeless } = resolveMappingTargets(m, OMNISTORE_HOME);
  // The external field keeps its declared home; only the orphan `note` falls to OmniStore.
  assert.deepEqual(targets["budget"], { broker: "n8n", backend: "sap", field: "ACDOCA" });
  assert.deepEqual(targets["note"], { broker: BUILTIN_BROKER, backend: OMNISTORE_BACKEND, field: "note" });
  assert.deepEqual(homeless, []);
});

test("HOMING (write): an orphan lands in the local bucket when homed, external stays external", () => {
  const m: Mapping = { id: "mixed", fields: { id: "id", budget: { broker: "n8n", backend: "sap", field: "ACDOCA" }, note: "note" } };
  // Off: `note` is homeless (never written); on: it writes locally (OmniStore is the built-in local home).
  assert.deepEqual(planMappingWrite(m, { note: "hi", budget: 5 }).homeless, ["note"]);
  const plan = planMappingWrite(m, { note: "hi", budget: 5 }, OMNISTORE_HOME);
  assert.deepEqual(plan.homeless, []);
  assert.equal(plan.sidecar["note"], "hi");                       // written to the local built-in store
  assert.deepEqual(plan.external.map((e) => e.key), ["budget"]);  // external field still routed out
});

test("HOMING keeps the sidecar home working (both built-in backends are local)", () => {
  const m: Mapping = { id: "s", broker: BUILTIN_BROKER, backend: SIDECAR_BACKEND, fields: { id: "id", note: "note" } };
  const plan = planMappingWrite(m, { note: "hi" }, OMNISTORE_HOME);
  assert.equal(plan.sidecar["note"], "hi"); // an explicit sidecar home is untouched and still local
});

test("HOMING (projection): an orphan field projects from the home rows once homed", () => {
  const m = orphanMapping();
  const rows = [{ rowId: "r1", note: "hello" }];
  // Off: the orphan structure is homeless → nothing projects.
  assert.deepEqual(projectMappingRows(rows, m), []);
  // On: the whole mapping homes to OmniStore, so structure + field read from the same local bucket.
  assert.deepEqual(projectMappingRows(rows, m, OMNISTORE_HOME), [{ id: "r1", note: "hello" }]);
});

// ── Invariant 2: superset when sole (capabilities honesty) ──────────────────────
const root = () => crypto.createHash("sha256").update("homing-test-root").digest();

test("SUPERSET: the built-in broker over OmniStore offers every capability domain", async () => {
  const caps = await new BuiltinBroker(new OmniStore(root())).capabilities();
  for (const d of CAPABILITY_DOMAINS) assert.equal(caps[d], true, `sole OmniStore must serve ${d}`);
});

test("SUPERSET: the built-in broker over the ephemeral MemoryStore does NOT — honest limited set", async () => {
  const caps = await new BuiltinBroker(new MemoryStore()).capabilities();
  assert.equal(caps["issues"], true);
  assert.equal(caps["raid"], true);
  // The enterprise tail a small ephemeral store carries no data for stays honestly OFF.
  assert.equal(caps["financials"], false);
  assert.equal(caps["crm"], false);
  assert.equal(caps["quality"], false);
});
