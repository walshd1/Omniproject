import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseTitles,
  normaliseRates,
  normaliseIdentities,
  resolveRateCard,
  usesBackend,
  referencedBackends,
  localSources,
  type RateCardSources,
  type LocalRateCard,
} from "./rate-card-source";
import { hashIdentity, emptyIdentityMap } from "./rate-card";

test("normaliseTitles hashes the source title and keeps the label as source of truth", () => {
  const t = normaliseTitles([{ title: "Senior Engineer" }, { title: "" }]);
  assert.equal(t[hashIdentity("Senior Engineer")], "Senior Engineer");
  assert.equal(Object.keys(t).length, 1); // the empty title is dropped
});

test("normaliseRates: missing projectType ⇒ '*'; missing facing applies to both", () => {
  const r = normaliseRates([
    { title: "Senior Engineer", rate: 100 }, // no projectType, no facing
    { title: "Senior Engineer", projectType: "delivery", facing: "client", rate: 150 },
    { title: "Bad", rate: NaN }, // dropped
  ]);
  const sh = hashIdentity("Senior Engineer");
  assert.deepEqual(r[sh]!["*"], { client: 100, internal: 100 }); // single finance rate → both facings
  assert.deepEqual(r[sh]!["delivery"], { client: 150 });
  assert.ok(!(hashIdentity("Bad") in r));
});

test("normaliseIdentities builds the hashed central map (no plaintext)", () => {
  const m = normaliseIdentities([{ assignee: "alice", title: "Senior Engineer" }]);
  assert.ok(!("alice" in m.central));
  assert.equal(m.central[hashIdentity("alice")], hashIdentity("Senior Engineer"));
});

test("usesBackend + referencedBackends reflect the configured sources", () => {
  assert.equal(usesBackend(localSources()), false);
  const mixed: RateCardSources = {
    titles: { kind: "backend", backend: "hr", action: "list_job_titles" },
    identities: { kind: "backend", backend: "hr", action: "list_staff_roles" },
    rates: { kind: "backend", backend: "finance", action: "list_rates" },
  };
  assert.equal(usesBackend(mixed), true);
  assert.deepEqual(referencedBackends(mixed).map((b) => b.backend).sort(), ["finance", "hr", "hr"].sort());
});

test("resolveRateCard composes titles from HR and rates from finance, leaving the store untouched", async () => {
  const local: LocalRateCard = { card: { titles: { local1: "Local Title" }, rates: {} }, identities: emptyIdentityMap() };
  const sources: RateCardSources = {
    titles: { kind: "backend", backend: "hr", action: "list_job_titles" },
    identities: { kind: "local" }, // identities stay local in this config
    rates: { kind: "backend", backend: "finance", action: "list_rates" },
  };
  const fetch = async (s: { backend: string }) =>
    s.backend === "hr" ? [{ title: "Senior Engineer" }] : [{ title: "Senior Engineer", rate: 120 }];
  const resolved = await resolveRateCard(sources, local, fetch as never);
  const sh = hashIdentity("Senior Engineer");
  assert.equal(resolved.card.titles[sh], "Senior Engineer"); // from HR, not the local "Local Title"
  assert.ok(!("local1" in resolved.card.titles));
  assert.deepEqual(resolved.card.rates[sh]!["*"], { client: 120, internal: 120 }); // from finance
  assert.equal(resolved.identities, local.identities); // local component passed through untouched
});

test("all-local sources resolve straight from the store without calling the fetcher", async () => {
  const local: LocalRateCard = { card: { titles: { a: "A" }, rates: {} }, identities: emptyIdentityMap() };
  let called = false;
  const resolved = await resolveRateCard(localSources(), local, async () => { called = true; return []; });
  assert.equal(called, false);
  assert.deepEqual(resolved.card.titles, { a: "A" });
});
