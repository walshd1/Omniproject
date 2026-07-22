import { test } from "node:test";
import assert from "node:assert/strict";
import { PRIMITIVE_CATALOGUE, primitiveCatalogue, resolvePrimitive, rootPrimitives, getPrimitive } from "./primitive-catalogue";
import { validatePrimitiveDef } from "./primitive-schema";

/**
 * Primitive COMPOSITION (the extends model): a primitive is either a ROOT (built on nothing) or a THIN child
 * that `extends` a parent and adds/alters params property-by-property. `resolvePrimitive` executes the chain and
 * records the lineage + per-field provenance, so any leaf traces back to the defs + fields it is built from.
 * These tests enforce the invariants: every chain resolves (no dangling parent, no cycle), roots are few and
 * generic, and a thin child (data-slot ← register ← table) composes as authored.
 */

test("every primitive's extends chain resolves — no dangling parent, no cycle (all defs call one above them)", () => {
  for (const p of primitiveCatalogue()) {
    assert.doesNotThrow(() => resolvePrimitive(p.id), `primitive "${p.id}" must resolve its extends chain`);
    if (p.extends) assert.ok(getPrimitive(p.extends), `"${p.id}" extends "${p.extends}" which must exist`);
  }
});

test("roots are FEW and generic; composed primitives are not roots", () => {
  const roots = rootPrimitives().map((r) => r.id);
  // `canvas` roots the VISUALS tree; `record` roots the DATA tree (all records belong to a set, so
  // record-set extends record). The visual `table` is a canvas made specific; the data structures
  // compose from record — none of them are roots.
  assert.ok(roots.includes("canvas"), "canvas is the visuals root");
  assert.ok(roots.includes("record"), "record is the data-structures root");
  assert.ok(!roots.includes("record-set"), "record-set is the set a record belongs to (extends record)");
  assert.ok(!roots.includes("table"), "table (visual) composes from canvas");
  assert.ok(!roots.includes("register"), "register composes from record-set");
  assert.ok(!roots.includes("data-slot"), "data-slot composes from register");
  // A root defines its own params (it is built on nothing).
  for (const r of rootPrimitives()) assert.ok(r.params.length > 0, `root "${r.id}" must define its params`);
});

test("data-slot ← register ← record-set ← record: the editable data structure flattens with provenance", () => {
  const ds = resolvePrimitive("data-slot")!;
  // The data tree bottoms out at `record` (a record belongs to a set → record-set extends record).
  assert.deepEqual(ds.lineage, ["data-slot", "register", "record-set", "record"]);
  // Inherited, added, and altered fields each trace to the def that supplied the winning value.
  assert.equal(ds.provenance["columns"], "record");  // the record's schema (fields), from the data root
  assert.equal(ds.provenance["collection"], "register"); // inherited from the middle
  assert.equal(ds.provenance["slot"], "data-slot");      // altered by the leaf (register's optional slot → required)
  assert.equal(ds.params.find((p) => p.key === "slot")?.required, true);
  // The leaf's OWN declared params are the thin delta — just what gives it genuinely-new functionality.
  assert.deepEqual(getPrimitive("data-slot")!.params.map((p) => p.key), ["slot"]);
});

test("a thin child may declare only optional params (it inherits its parent's required ones); a root may not be empty", () => {
  // register has NO required param of its own — valid, because it inherits table's required `columns`.
  const reg = { id: "reg-x", label: "R", category: "table", description: "d", extends: "table", params: [{ key: "endpoint", label: "E", type: "string", required: false, description: "d" }] };
  assert.equal(validatePrimitiveDef(reg).ok, true);
  // A child may even add NO params (pure relabel).
  assert.equal(validatePrimitiveDef({ id: "reg-y", label: "R", category: "table", description: "d", extends: "table", params: [] }).ok, true);
  // A ROOT (no extends) must define params.
  assert.equal(validatePrimitiveDef({ id: "root-z", label: "R", category: "table", description: "d", params: [] }).ok, false);
});

test("the shipped catalogue array and every entry validate against the schema (incl. extends)", () => {
  for (const p of PRIMITIVE_CATALOGUE) {
    const v = validatePrimitiveDef(p);
    assert.ok(v.ok, `"${p.id}" must validate: ${v.errors.join("; ")}`);
  }
});
