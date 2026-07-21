import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot } from "../lib/config-snapshot";
import { getSettings } from "../lib/settings";

/**
 * Config-purity guard — the data/config boundary detector.
 *
 * OmniProject's config (settings, label overrides, vendor defs, …) is a folder of
 * JSON the operator keeps; TRUE customer data (projects/issues/…) is never at rest
 * here — it is brokered live from the backend systems of record. So losing or
 * corrupting the config JSON must never touch the data underneath. This guard
 * fails CI if a data-bearing entity key ever leaks into the config snapshot (the
 * shape that is dumped to / read from config.json), e.g. someone "caching" issues
 * in settings.
 */

// Entity/record keys that belong to the BACKENDS (the brokered systems of record), never to config. If one of
// these appears as a top-level settings collection, brokered data has leaked into config (e.g. someone
// "caching" issues in settings).
const FORBIDDEN_DATA_KEYS = new Set([
  "projects", "project", "issues", "issue", "tasks", "task", "activity",
  "raid", "baseline", "baselines", "history", "summary", "summaries",
  "members", "rows", "fxrates", "portfoliohealth", "notificationsdata",
]);

// CONFIG subtrees whose OWN field names legitimately collide with entity words but are app-authored config,
// NOT brokered SoR data — so the deep scan skips inside them (it still guards everything else). These are the
// in-app registers/policy the org authors (directive: they travel as part of "total state") plus the
// retention-cadence map whose keys are SCOPE labels ("project"/"programme"/"org"), not project data.
const CONFIG_SUBTREES = new Set([
  "raci", "stakeholders", "resourceAllocations", "budgetPlans", "historyRetention",
]);

/** Every object key in a value, recursively, lower-cased — but not descending into the known config subtrees
 *  (whose entity-word field names are config, not cached brokered data). */
function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k.toLowerCase());
      if (CONFIG_SUBTREES.has(k)) continue; // config register/policy — its inner keys aren't brokered data
      allKeys(v, out);
    }
  }
  return out;
}

test("config snapshot carries no data-bearing entity keys (brokered SoR data must never cache in config)", () => {
  const snapshot = buildSnapshot(getSettings());
  const offenders = [...allKeys(snapshot)].filter((k) => FORBIDDEN_DATA_KEYS.has(k));
  assert.deepEqual(
    offenders,
    [],
    `Config must never hold brokered customer data — these data-entity keys leaked into the config snapshot: ${offenders.join(", ")}`,
  );
});

test("config snapshot is wrapped, versioned config (not raw data)", () => {
  const snapshot = buildSnapshot(getSettings());
  assert.equal(typeof snapshot.schema, "string");
  assert.equal(typeof snapshot.version, "number");
  // The payload is `settings` only — there is no project/issue array to lose.
  assert.deepEqual(Object.keys(snapshot).sort(), ["createdAt", "schema", "settings", "version"]);
});
