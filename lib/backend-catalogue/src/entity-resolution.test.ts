import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeEntities, matchCandidates, normaliseKey } from "./entity-resolution";

interface Person { source: string; name: string; email?: string; externalId?: string }

const PEOPLE: Person[] = [
  { source: "jira", name: "Alice Smith", email: "alice@acme.io", externalId: "u-1" },
  { source: "salesforce", name: "Alice Smith", email: "ALICE@acme.io", externalId: "c-9" },
  { source: "jira", name: "Bob Jones", email: "bob@acme.io", externalId: "u-2" },
  { source: "erp", name: "alice  smith", email: "alice@acme.io" },
];

test("dedupeEntities merges records sharing a deterministic key; later wins", () => {
  const resolved = dedupeEntities(PEOPLE, (p) => p.email?.toLowerCase() ?? null);
  // alice@acme.io appears in jira + erp (same exact key) → merged; salesforce uses
  // ALICE@acme.io which lowercases to the same → all three alices fold together.
  const alice = resolved.find((r) => r.key === "alice@acme.io")!;
  assert.equal(alice.count, 3);
  assert.equal(alice.merged.source, "erp"); // last record wins the shallow overlay
  // Bob stands alone.
  assert.equal(resolved.find((r) => r.key === "bob@acme.io")!.count, 1);
});

test("dedupeEntities never merges records with no key — each stands alone", () => {
  const noKeys: Person[] = [{ source: "a", name: "X" }, { source: "b", name: "Y" }];
  const resolved = dedupeEntities(noKeys, (p) => p.email ?? null);
  assert.equal(resolved.length, 2);
  assert.ok(resolved.every((r) => r.count === 1 && r.key === ""));
});

test("matchCandidates surfaces ≥2-record groups per matcher, never merging", () => {
  const candidates = matchCandidates(PEOPLE, [
    { name: "email", fn: (p) => normaliseKey(p.email) },
    { name: "name", fn: (p) => normaliseKey(p.name) },
  ]);
  // Both matchers flag the three Alices (the name matcher collapses "alice  smith").
  const byEmail = candidates.find((c) => c.matchedOn === "email" && c.key === "alice@acme.io")!;
  assert.equal(byEmail.records.length, 3);
  const byName = candidates.find((c) => c.matchedOn === "name" && c.key === "alice smith")!;
  assert.equal(byName.records.length, 3);
  // Bob is a singleton under every matcher ⇒ never a candidate.
  assert.ok(!candidates.some((c) => c.records.some((r) => r.name === "Bob Jones") && c.records.length === 1));
});

test("normaliseKey lowercases, trims and collapses whitespace", () => {
  assert.equal(normaliseKey("  Alice   Smith "), "alice smith");
  assert.equal(normaliseKey(""), null);
  assert.equal(normaliseKey(null), null);
});
