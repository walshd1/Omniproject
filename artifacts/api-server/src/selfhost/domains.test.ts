import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_FIELD_KEYS } from "@workspace/backend-catalogue";
import {
  SELF_HOST_DOMAINS,
  SELF_HOST_FIELD_KEYS,
  domainById,
  selfHostGovernanceId,
  type SelfHostDomainId,
} from "./domains";

test("every domain field resolves to a real registry field — no phantom keys", () => {
  for (const d of SELF_HOST_DOMAINS) {
    assert.ok(d.fields.length > 0, `${d.id} should own at least one field`);
    for (const f of d.fields) {
      assert.ok(CANONICAL_FIELD_KEYS.has(f.key), `${d.id}.${f.key} must be a canonical field`);
    }
  }
});

test("the domain partition is disjoint — no field is owned by two domains", () => {
  const seen = new Map<string, SelfHostDomainId>();
  for (const d of SELF_HOST_DOMAINS) {
    for (const f of d.fields) {
      const prior = seen.get(f.key);
      assert.equal(prior, undefined, `${f.key} owned by both ${prior} and ${d.id}`);
      seen.set(f.key, d.id);
    }
  }
});

test("issues is the only core (always-adoptable) domain; the rest are gated", () => {
  const core = SELF_HOST_DOMAINS.filter((d) => d.core).map((d) => d.id);
  assert.deepEqual(core, ["issues"]);
  for (const d of SELF_HOST_DOMAINS) {
    if (d.core) assert.equal(d.gate, null, "core domains are not gated");
    else assert.ok(d.gate === "storage" || d.gate === "cost", `${d.id} needs a storage/cost gate`);
  }
});

test("financials & baseline & history are storage-gated; resources is cost-gated", () => {
  assert.equal(domainById("financials").gate, "storage");
  assert.equal(domainById("baseline").gate, "storage");
  assert.equal(domainById("history").gate, "storage");
  assert.equal(domainById("resources").gate, "cost");
});

test("the governance id is the namespaced selfhost:<domain>", () => {
  assert.equal(selfHostGovernanceId("financials"), "selfhost:financials");
});

test("SELF_HOST_FIELD_KEYS is the union of every domain's fields", () => {
  const union = new Set(SELF_HOST_DOMAINS.flatMap((d) => d.fields.map((f) => f.key)));
  assert.deepEqual([...SELF_HOST_FIELD_KEYS].sort(), [...union].sort());
});

test("domainById throws on an unknown id", () => {
  assert.throws(() => domainById("nope" as SelfHostDomainId), /unknown self-host domain/);
});
