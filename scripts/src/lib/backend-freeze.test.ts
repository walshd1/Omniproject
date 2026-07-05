import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCatalogueFreeze, CATALOGUE_BASELINE_COUNT, FLAGSHIP_BACKEND_IDS, type VerifiableBackend } from "./backend-freeze";

function backendsAt(count: number, overrides: Record<string, string> = {}): VerifiableBackend[] {
  const rows: VerifiableBackend[] = [];
  for (let i = 0; i < count; i++) {
    const id = `backend-${i}`;
    rows.push({ id, verification: overrides[id] ?? "catalogued" });
  }
  for (const [id, verification] of Object.entries(overrides)) {
    if (!rows.some((r) => r.id === id)) rows.push({ id, verification });
  }
  return rows;
}

test("does not throw at or under the baseline count, regardless of verification", () => {
  assert.doesNotThrow(() => checkCatalogueFreeze(backendsAt(CATALOGUE_BASELINE_COUNT)));
  assert.doesNotThrow(() => checkCatalogueFreeze(backendsAt(1)));
});

test("throws once the catalogue grows past baseline with an unverified flagship", () => {
  assert.throws(
    () => checkCatalogueFreeze(backendsAt(CATALOGUE_BASELINE_COUNT + 1)),
    /frozen at 41 backends/,
  );
});

test("error names exactly the still-unverified flagship ids", () => {
  const overrides = Object.fromEntries(FLAGSHIP_BACKEND_IDS.map((id) => [id, "verified"]));
  overrides[FLAGSHIP_BACKEND_IDS[0]] = "catalogued"; // leave one unverified
  try {
    checkCatalogueFreeze(backendsAt(CATALOGUE_BASELINE_COUNT + 1, overrides));
    assert.fail("expected checkCatalogueFreeze to throw");
  } catch (e) {
    const msg = (e as Error).message;
    assert.match(msg, new RegExp(FLAGSHIP_BACKEND_IDS[0]));
    for (const id of FLAGSHIP_BACKEND_IDS.slice(1)) assert.doesNotMatch(msg, new RegExp(`Still unverified:.*${id}`));
  }
});

test("does not throw past baseline once every flagship backend is verified", () => {
  const overrides = Object.fromEntries(FLAGSHIP_BACKEND_IDS.map((id) => [id, "verified"]));
  assert.doesNotThrow(() => checkCatalogueFreeze(backendsAt(CATALOGUE_BASELINE_COUNT + 1, overrides)));
});

test("a missing flagship backend counts as unverified", () => {
  // No backend named "jira" exists at all in this list.
  const overrides = Object.fromEntries(FLAGSHIP_BACKEND_IDS.filter((id) => id !== "jira").map((id) => [id, "verified"]));
  assert.throws(() => checkCatalogueFreeze(backendsAt(CATALOGUE_BASELINE_COUNT + 1, overrides)), /jira/);
});
