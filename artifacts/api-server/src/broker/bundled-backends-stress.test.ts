import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backendCatalogue,
  getBackend,
  brokerCatalogue,
  getBrokerDef,
  brokerSupport,
  brokersForTransport,
  BROKER_CAPABILITY_KEYS,
  transportOf,
  validateVendor,
  type BackendDefinition,
} from "@workspace/backend-catalogue";
import { CAPABILITY_DOMAINS } from "../lib/capabilities";
import { FIELD_REGISTRY, CANONICAL_FIELD_KEYS, reconcileFields, customFieldsFrom } from "../lib/field-registry";
import { CANONICAL_STATUS } from "./vocabulary";
import { applyVendorProfile, vendorCapabilities, demoVendorFor } from "./vendor-profile";
import { DemoBroker } from "./demo";
import { messifyRows, type MessyConfig } from "../lib/messy-data";
import type { ActorContext, Row, Broker } from "./types";

/**
 * BUNDLED BACKENDS STRESS HARNESS
 * ================================
 * Drives EVERY bundled backend + broker + vendor-profile definition through an
 * adversarial gauntlet and asserts the ONE HTTP contract seam holds each one up:
 *
 *   1. schema-valid + loads via the catalogue accessor;
 *   2. capability + transport mapping is internally consistent (no capability a
 *      transport can't serve; brokerSupport non-empty where expected; a def maps
 *      ≥1 capability OR is correctly treated as no-purpose);
 *   3. the demo-AS-vendor spoof (applyVendorProfile / demoVendorFor) GATES the
 *      surface to the vendor's declared capabilities and a thin-file spoof never
 *      appears over real data;
 *   4. describeFields reconciliation against the canonical FIELD_REGISTRY does not
 *      crash and flags unknown fields as gated passthrough;
 *   5. driving the demo read model AS each vendor through the messy-data transform
 *      (high intensity, several seeds) does not crash and preserves row counts.
 *
 * The list is READ from the catalogue — never hardcoded — so a new/removed vendor
 * is picked up automatically. This is the proof the seam is clean.
 */

const CTX: ActorContext = { email: "stress@demo.local", name: "Stress Harness" } as ActorContext;
const CAP_DOMAIN_SET = new Set<string>(CAPABILITY_DOMAINS);
const CANONICAL_STATUS_SET = new Set<string>(CANONICAL_STATUS);

// The catalogue is the single source of truth for the list under test.
const BACKENDS = backendCatalogue();
const BACKEND_DEFS = BACKENDS.map((b) => getBackend(b.id)!);
const BROKERS = brokerCatalogue();

// The read methods the demo broker exposes that produce ROW LISTS, keyed by how we
// call them. Preserving these counts through the messy transform proves the seam
// mutates VALUES/provenance, never severs rows.
const SAMPLE_PROJECT_ID = "proj-001";

test("harness: the catalogue is non-empty (guards against an empty/blank catalogue)", () => {
  assert.ok(BACKENDS.length > 0, "expected at least one bundled backend");
  assert.ok(BROKERS.length > 0, "expected at least one bundled broker");
  assert.equal(BACKENDS.length, BACKEND_DEFS.length, "every catalogue entry resolves via getBackend");
});

// ── Per-BACKEND stress ─────────────────────────────────────────────────────────
for (const summary of BACKENDS) {
  const id = summary.id;
  const def = getBackend(id) as BackendDefinition;

  test(`backend[${id}]: schema-valid, loads via accessor, no dangling capability keys`, () => {
    // (1) loads via the catalogue accessor
    assert.ok(def, `getBackend(${id}) must resolve`);
    assert.equal(def.id, id);

    // (1) schema-valid against the embedded per-plane schema
    const errs = validateVendor("backends", def);
    assert.deepEqual(errs, [], `${id} fails backend schema:\n${errs.join("\n")}`);

    // No capability domain the resolver doesn't know about (a typo'd domain would
    // silently never gate anything). Empty-map is allowed (see no-purpose below).
    for (const k of Object.keys(def.capabilities)) {
      assert.ok(CAP_DOMAIN_SET.has(k), `${id} declares unknown capability domain "${k}"`);
    }

    // statusVocabulary (when declared) must map onto CANONICAL statuses only —
    // otherwise its dialect never folds into the completion maths.
    if (def.statusVocabulary) {
      for (const [native, canon] of Object.entries(def.statusVocabulary.toCanonical)) {
        assert.ok(CANONICAL_STATUS_SET.has(canon), `${id} statusVocabulary maps "${native}" → non-canonical "${canon}"`);
      }
      for (const canon of Object.keys(def.statusVocabulary.fromCanonical ?? {})) {
        assert.ok(CANONICAL_STATUS_SET.has(canon), `${id} statusVocabulary fromCanonical has non-canonical key "${canon}"`);
      }
    }
  });

  test(`backend[${id}]: capability + transport mapping is internally consistent`, () => {
    const kind = def.kind ?? "live";
    const onCaps = Object.entries(def.capabilities).filter(([, v]) => v).map(([k]) => k);
    const actions = Object.keys(def.actions);

    // (2) a def maps ≥1 capability OR is correctly treated as no-purpose. Every
    // bundled backend exists to populate SOME domain — a zero-capability backend
    // would light up nothing and is a dead entry.
    assert.ok(onCaps.length > 0, `${id} declares no capability — it has no purpose in the catalogue`);

    // (2) transport is derived from the binding (single source of truth), never drifts.
    const transport = transportOf(def);
    assert.equal(transport, summary.transport, `${id} transport drift: def=${transport} catalogue=${summary.transport}`);
    assert.ok(transport === "http" || transport === "native-node");

    // native-node transport can only be served by a broker that declares it (n8n).
    // The catalogue's own broker list for this backend must agree with the registry.
    const expectedBrokers = kind === "import" ? [] : brokersForTransport(transport);
    assert.deepEqual([...summary.brokers].sort(), [...expectedBrokers].sort(), `${id} broker set drifts from brokersForTransport`);

    // A LIVE/DATABASE backend must expose the read/write contract actions it needs
    // to be brokered; an IMPORT source is fed through /api/import and lists none.
    if (kind === "import") {
      assert.equal(actions.length, 0, `${id} is an import source but declares broker actions`);
      assert.deepEqual(summary.brokers, [], `${id} is import ⇒ no live brokers`);
    } else {
      assert.ok(actions.includes("list_projects"), `${id} (${kind}) must implement list_projects`);
      assert.ok(actions.includes("list_issues"), `${id} (${kind}) must implement list_issues`);
      assert.ok(summary.brokers.length > 0, `${id} (${kind}) is brokered but no broker can reach its transport`);
    }

    // keyFormat: a live/database backend must resolve to a REAL key scheme (never
    // keyless) so keyless access is hard-rejected; only import is genuinely keyless.
    const kf = summary.keyFormat;
    assert.ok(kf && typeof kf.scheme === "string", `${id} has no resolvable key format`);
    if (kind === "import") {
      assert.equal(kf.scheme, "none", `${id} import source should be keyless`);
    } else {
      assert.notEqual(kf.scheme, "none", `${id} (${kind}) resolves to keyless "none" — keyless access can't be rejected`);
    }
  });

  test(`backend[${id}]: demo-AS-vendor spoof GATES the surface to declared capabilities`, async () => {
    // (3) applyVendorProfile presents the demo broker AS this vendor with exactly
    // its declared capability surface — domains the vendor does NOT declare are
    // hidden, even though the underlying demo supports everything.
    const declared = vendorCapabilities(id);
    assert.ok(declared, `vendorCapabilities(${id}) must resolve`);

    const demo: Broker = new DemoBroker();
    const asVendor = applyVendorProfile(demo, id);

    // The spoof is unmistakably a thin-file facade, NEVER a live integration.
    assert.equal(asVendor.kind, `${id}-demo`, `spoof kind must carry the -demo suffix`);
    assert.equal(asVendor.live, false, `${id} spoof must not claim to be live`);

    const caps = await asVendor.capabilities(CTX);
    for (const d of CAPABILITY_DOMAINS) {
      assert.equal(caps[d], !!declared![d], `${id} spoof surfaces "${d}" as ${caps[d]}, declared ${!!declared![d]}`);
    }

    // Capability-gated read methods return EMPTY when the vendor doesn't declare
    // the domain, but still serve the underlying demo data when it does.
    const raid = await asVendor.listRaid!(CTX, SAMPLE_PROJECT_ID);
    if (declared!["raid"]) assert.ok(Array.isArray(raid));
    else assert.deepEqual(raid, [], `${id} does not declare raid ⇒ listRaid must be gated empty`);

    const fin = await asVendor.projectFinancials!(CTX, SAMPLE_PROJECT_ID);
    if (!declared!["financials"]) assert.deepEqual(fin, {}, `${id} does not declare financials ⇒ gated empty`);

    const cap = await asVendor.resourceCapacity!(CTX, SAMPLE_PROJECT_ID);
    if (!declared!["resources"]) assert.deepEqual(cap, [], `${id} does not declare resources ⇒ gated empty`);

    const base = await asVendor.baseline!(CTX, SAMPLE_PROJECT_ID);
    if (!declared!["baseline"]) assert.equal(base, null, `${id} does not declare baseline ⇒ gated null`);

    // Supported domains still see the underlying demo DATA (the spoof shapes the
    // surface, it does not blank everything).
    const projects = await asVendor.listProjects(CTX);
    assert.ok(projects.length > 0, `${id} spoof must still serve demo projects`);
  });

  test(`backend[${id}]: demoVendorFor never lets a thin-file spoof over REAL data`, () => {
    // (3) the spoof applies ONLY in pure demo mode; a real backend or the dev
    // broker suppresses it, so production never shows a "-demo" facade.
    assert.equal(demoVendorFor({ devActive: false, realBackend: false, source: id }), id, `${id} should flavour pure demo`);
    assert.equal(demoVendorFor({ devActive: false, realBackend: true, source: id }), null, `${id} must NOT spoof over a real backend`);
    assert.equal(demoVendorFor({ devActive: true, realBackend: false, source: id }), null, `${id} must NOT spoof over the dev broker`);
  });
}

// ── describeFields reconciliation against the canonical registry ─────────────────
test("reconcile: describeFields reconciles against FIELD_REGISTRY without crashing, unknowns are gated passthrough", async () => {
  // (4) The demo broker's describe exposes the canonical registry PLUS a couple of
  // custom fields the registry doesn't model. Reconciliation must NOT crash and
  // must flag the non-canonical ones as gated custom-field passthrough.
  const demo: Broker = new DemoBroker();
  const enumerated = await demo.describeFields!(CTX);
  assert.ok(enumerated.length >= FIELD_REGISTRY.length, "describe must at least cover the registry");

  const recon = reconcileFields(enumerated);
  // Every known key is canonical; every unknown key is genuinely non-canonical.
  for (const k of recon.known) assert.ok(CANONICAL_FIELD_KEYS.has(k), `${k} reported known but not canonical`);
  for (const k of recon.unknown) assert.ok(!CANONICAL_FIELD_KEYS.has(k), `${k} reported unknown but is canonical`);

  const customs = customFieldsFrom(enumerated);
  // Non-canonical fields surface as gated passthrough (surface on, store defaults off).
  assert.ok(customs.length > 0, "the demo's tenant/custom fields must surface as passthrough");
  for (const c of customs) {
    assert.ok(!CANONICAL_FIELD_KEYS.has(c.key), `custom field ${c.key} leaked a canonical key`);
    assert.equal(c.surface, true, `custom field ${c.key} must surface`);
  }
});

test("reconcile: an ADVERSARIAL describe (dupes, empties, injected canonical & garbage) never crashes", () => {
  // (4) Reconciliation over hostile enumeration input must be crash-proof and
  // still classify correctly: garbage → unknown, canonical → known, dupes deduped.
  const canonicalSample = FIELD_REGISTRY[0]!.key;
  const hostile = [
    { key: canonicalSample },
    { key: canonicalSample }, // duplicate canonical
    { key: "" }, // empty key — must be skipped, not crash
    { key: "tenant_custom_xyz" },
    { key: "tenant_custom_xyz" }, // duplicate unknown
    { key: "🚀weird-field", label: undefined as unknown as string },
    { key: "accountId", references: "account" },
  ];
  const recon = reconcileFields(hostile);
  assert.ok(recon.known.includes(canonicalSample));
  assert.equal(recon.known.filter((k) => k === canonicalSample).length, 1, "duplicate canonical must be deduped");
  assert.ok(recon.unknown.includes("tenant_custom_xyz"));
  assert.equal(recon.unknown.filter((k) => k === "tenant_custom_xyz").length, 1, "duplicate unknown must be deduped");
  const customs = customFieldsFrom(hostile);
  // Empty-key entry contributes nothing; canonical entry is not a custom field.
  assert.ok(customs.every((c) => c.key !== "" && !CANONICAL_FIELD_KEYS.has(c.key)));
});

// ── Messy-data gauntlet: drive the demo read model AS each vendor ────────────────
/** High-intensity messy configs across several seeds — the adversarial data. */
const MESSY_SEEDS = ["omni", "alpha", "bravo", "charlie", "delta"];
function messyConfig(seed: string): MessyConfig {
  return { on: true, seed, intensity: 1, gremlins: [] };
}

test("messy-data: driving EACH vendor's demo read model through the transform preserves row counts & never crashes", async () => {
  // (5) For each bundled vendor, present the demo AS that vendor, pull its readable
  // row lists, and push them through the messy transform at MAX intensity over
  // several seeds. The transform mutates VALUES/provenance — row COUNT must survive
  // (the seam never silently drops a record), and nothing throws.
  const demo: Broker = new DemoBroker();
  const projects = (await demo.listProjects(CTX)) as unknown as Row[];
  const issues = (await demo.listIssues(CTX, SAMPLE_PROJECT_ID)) as unknown as Row[];
  const raid = await demo.listRaid(CTX, SAMPLE_PROJECT_ID);
  // Sanity: the fixtures must actually carry rows, or the count invariant is vacuous.
  assert.ok(projects.length > 0 && issues.length > 0, "demo fixtures must carry rows to stress");

  const readSets: Array<{ label: string; rows: Row[] }> = [
    { label: "projects", rows: projects },
    { label: "issues", rows: issues },
    { label: "raid", rows: raid },
  ];

  let combos = 0;
  for (const backend of BACKENDS) {
    const asVendor = applyVendorProfile(demo, backend.id);
    // Reading through the vendor-flavoured broker must itself never crash.
    const vProjects = (await asVendor.listProjects(CTX)) as unknown as Row[];
    assert.ok(Array.isArray(vProjects));

    for (const seed of MESSY_SEEDS) {
      const cfg = messyConfig(seed);
      for (const set of readSets) {
        const messy = messifyRows(set.rows, cfg, `${backend.id}:${set.label}`);
        assert.equal(messy.length, set.rows.length, `${backend.id}/${set.label}@${seed}: row count changed (${set.rows.length}→${messy.length})`);
        // The transform must not sever a row from its project (projectId protected).
        for (let i = 0; i < messy.length; i++) {
          const original = set.rows[i] as Record<string, unknown>;
          if (set.label !== "projects" && "projectId" in original) {
            assert.equal((messy[i] as Record<string, unknown>)["projectId"], original["projectId"], `${backend.id}/${set.label}@${seed}: projectId severed`);
          }
        }
        combos++;
      }
    }
  }
  // Enough coverage to be meaningful: every backend × every seed × every read set.
  assert.equal(combos, BACKENDS.length * MESSY_SEEDS.length * readSets.length);
});

// ── Per-BROKER stress ────────────────────────────────────────────────────────────
for (const broker of BROKERS) {
  test(`broker[${broker.id}]: schema-valid, synchronous invariant, non-empty support, ≥1 capability (purpose)`, () => {
    const def = getBrokerDef(broker.id);
    assert.ok(def, `getBrokerDef(${broker.id}) must resolve`);

    const errs = validateVendor("brokers", def);
    assert.deepEqual(errs, [], `${broker.id} fails broker schema:\n${errs.join("\n")}`);

    // The broker plane invariant: every broker is the synchronous data hop.
    assert.equal(def!.capabilities.synchronous, true, `${broker.id} must be synchronous (broker plane invariant)`);

    // brokerSupport is non-empty and covers every capability key (so the resolver
    // never sees a partial support map for a known broker).
    const support = brokerSupport(broker.id);
    assert.deepEqual(Object.keys(support).sort(), [...BROKER_CAPABILITY_KEYS].sort(), `${broker.id} support map is incomplete`);

    // (2) ≥1 capability true ⇒ has purpose. Synchronous is always on, so this holds,
    // but assert explicitly so a hypothetical all-false broker is caught.
    const anyOn = Object.values(support).some(Boolean);
    assert.ok(anyOn, `${broker.id} maps no capability — no purpose in the deployment`);

    // Transports must be a non-empty subset of the known transport methods, and a
    // broker that declares native-node must be able to (only n8n does).
    assert.ok(def!.transports.length > 0, `${broker.id} declares no transport`);
    for (const t of def!.transports) assert.ok(t === "http" || t === "native-node", `${broker.id} unknown transport ${t}`);
    if (def!.transports.includes("native-node")) {
      assert.ok(brokersForTransport("native-node").includes(broker.id as never), `${broker.id} claims native-node but isn't in the native-node broker set`);
    }
  });
}
