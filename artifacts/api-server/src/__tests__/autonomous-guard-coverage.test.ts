import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GUARDED_WRITES } from "../broker/autonomous-guard";

/**
 * Autonomous-guard parity gate — the always-on autonomous-write guard (broker/autonomous-guard.ts) is
 * a FAIL-CLOSED gate, but only if it actually WRAPS every mutation. Two drift risks used to make it
 * fail OPEN: (1) a method listed as guarded with no request-classifier silently skipped the check;
 * (2) a NEW broker mutation nobody added to the guarded set was never wrapped at all.
 *
 * (1) is now impossible by construction — GUARDED_WRITES is derived from the classifier registry, so
 * this test just re-asserts that. (2) is what this gate closes: EVERY method on the `Broker` interface
 * must be either guarded (a mutation) or in the explicit KNOWN_NON_MUTATING allowlist (a read). A new
 * broker method fails this test until a human classifies it — so a mutation can't slip in unguarded.
 *
 * Same idiom as egress-fetch-guard / no-unsafe-json-parse: read the source, enforce the invariant.
 */

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** Read-only `Broker` methods that legitimately need NO autonomous-write authorization. Adding a new
 *  broker method forces a choice: classify it in broker/autonomous-guard's registry (mutation) or add
 *  it here (read). `commandWithSource` is guarded but lives on the concrete broker, not this interface. */
const KNOWN_NON_MUTATING = new Set([
  "baseline", "capabilities", "changeToken", "describeFields", "describeSchema", "fieldMap", "fxRates",
  "getIssue", "getTask", "listActivity", "listIssues", "listProjects", "listRaid", "listTaskAttachments",
  "listTaskComments", "listTaskItems", "listTasks", "notifications", "portfolioHealth", "projectFinancials",
  "projectHistory", "projectMembers", "projectSummary", "replay", "resourceCapacity", "verify", "verifyConnection",
  // Wiki reads (bodies fetched from the backend through the seam; writeWikiDoc is the guarded mutation).
  "getWikiDoc", "listWikiDocs", "listWikiSpaces", "listWikiDocVersions", "getWikiDocVersion",
  // Whiteboard reads (writeWhiteboard is the guarded mutation).
  "getWhiteboard", "listWhiteboards",
  // Native handoff (X.1): nativeSurfaces lists the surfaces a backend fronts (read); nativeHandoff MINTS a
  // per-request vendor URL (no store mutation — route stamps write:false). nativeImport IS the guarded
  // mutation (attachment written to the target), so it lives in WRITE_CLASSIFIERS, not here.
  "nativeSurfaces", "nativeHandoff",
  // SAP / ERP read models (§4.6): the WBS cost tree + per-WBS financial roll-up — READ-ONLY, brokered from
  // the system of record (SAP keeps the ledger; we never post).
  "listWbsElements", "getWbsFinancials",
  // Dependency graph (§5.5): listDependencies is READ-ONLY; writeDependency + removeDependency are the guarded
  // mutations (WRITE_CLASSIFIERS in broker/autonomous-guard).
  "listDependencies",
  // Sprints / iterations (§5.5): listSprints is READ-ONLY; writeSprint + removeSprint are the guarded mutations.
  "listSprints",
]);

/** Extract the method names declared on `export interface Broker { … }` from types.ts (methods only —
 *  a name optionally followed by `?`/generics then `(`; `readonly kind: …` properties are excluded). */
function brokerInterfaceMethods(): string[] {
  const src = fs.readFileSync(path.join(SRC, "broker", "types.ts"), "utf8");
  const start = src.indexOf("export interface Broker ");
  assert.ok(start >= 0, "could not find `export interface Broker` in broker/types.ts");
  // Walk to the matching close brace of the interface body.
  const open = src.indexOf("{", start);
  let depth = 0, end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(open + 1, end);
  const methods = new Set<string>();
  for (const m of body.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??(?:<[^>]*>)?\(/gm)) methods.add(m[1]!);
  return [...methods];
}

test("parity: GUARDED_WRITES is exactly the classifier registry (can't drift)", () => {
  // GUARDED_WRITES is derived from WRITE_CLASSIFIERS keys, so a guarded method ALWAYS has a classifier
  // and can never fall through to an ungated write. This asserts the derivation stays intact.
  assert.ok(GUARDED_WRITES.has("writeIssue"));
  assert.ok(GUARDED_WRITES.has("storeCredential"));
  assert.ok(GUARDED_WRITES.has("commandWithSource"));
  assert.ok(GUARDED_WRITES.size >= 11);
});

test("gate: every Broker interface method is classified guarded-or-read-only (no unguarded mutation)", () => {
  const methods = brokerInterfaceMethods();
  assert.ok(methods.length >= 30, `expected the Broker interface parse to find its methods, got ${methods.length}`);
  const unclassified = methods.filter((m) => !GUARDED_WRITES.has(m) && !KNOWN_NON_MUTATING.has(m));
  assert.deepEqual(
    unclassified,
    [],
    `Broker method(s) neither guarded nor allow-listed as read-only: ${unclassified.join(", ")}\n` +
      "→ If it MUTATES, add a classifier to broker/autonomous-guard.ts WRITE_CLASSIFIERS (fail-closed).\n" +
      "→ If it's READ-ONLY, add it to KNOWN_NON_MUTATING in this test.",
  );

  // And no stale allow-list entries (a removed/renamed read method should be pruned here).
  const stale = [...KNOWN_NON_MUTATING].filter((m) => !methods.includes(m)).sort();
  assert.deepEqual(stale, [], `Stale KNOWN_NON_MUTATING entries (no longer on the Broker interface): ${stale.join(", ")}`);
});
