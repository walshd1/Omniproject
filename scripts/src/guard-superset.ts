/**
 * Superset guard — enforces the invariant that every backend's field set is a strict SUBSET of
 * the canonical superset. A backend may CONTRIBUTE fields (its `fields[]`, merged into the
 * superset by gen-fields) but may only REFERENCE field keys (its `fieldKeys[]`) that exist in the
 * superset. This makes "the superset ⊇ every backend, OpenProject included" a property the build
 * cannot violate: a typo or an orphan reference fails CI here.
 *
 * Run: pnpm --filter @workspace/scripts run guard-superset
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuperset, backendFieldRefs } from "./lib/superset";
import { reportGuard } from "./lib/guard-harness";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const { keys } = loadSuperset(ROOT); // throws on a conflicting field redefinition
const refs = backendFieldRefs(ROOT);

const violations: string[] = [];
let refCount = 0;
for (const { file, keys: fieldKeys } of refs) {
  for (const k of fieldKeys) {
    refCount++;
    if (!keys.has(k)) violations.push(`  backends/${file}: "${k}"`);
  }
}

reportGuard("superset", {
  violations,
  failHeadline: `superset guard: FAIL — ${violations.length} backend field reference(s) are NOT in the superset`,
  help:
    "Every backend's fieldKeys[] must be a subset of the superset. Add the field to " +
    "assets/fields.json (or contribute it via the backend's fields[]), or fix the reference.",
  okSummary: `${refs.length} backends, ${refCount} field refs, all ⊆ superset (${keys.size} fields).`,
});
