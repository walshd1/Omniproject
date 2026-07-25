import test from "node:test";
import assert from "node:assert/strict";
import { screenDefCatalogue } from "./screen-def-catalogue";
import { resolvePrimitive, getPrimitive, primitiveCatalogue } from "./primitive-catalogue";
import { methodologyCatalogue } from "./methodology-catalogue";

/**
 * SCREENS ARE BUILT FROM PRIMITIVES. A screen is a `canvas` + panels; a panel that isn't a bespoke engine kind
 * (`view`/`component`/…) renders through a primitive family that composes down to a tree root. This proves that
 * property by RENDERING each atom-composed screen through the resolver and checking the result against the
 * canonical standard — visuals → `canvas`, data → `record`, cross-cutting atoms at their own root. The
 * methodology overview screens are ordinary catalogue screens; they are simply the ones authored purely from
 * atoms, so they are exactly the set this exercises.
 */

// A panel `kind` → the primitive family it renders through (only the atom-composable kinds; a kind absent here
// is a bespoke engine panel, not expressed as a primitive composition).
const PANEL_PRIMITIVE: Record<string, string> = {
  chart: "chart", table: "table", register: "register", tile: "tile",
  metric: "stat-tile", field: "field", form: "form", geometry: "geometry-canvas", text: "label",
};
// Each family's canonical tree root.
const EXPECTED_ROOT: Record<string, string> = {
  chart: "canvas", table: "canvas", form: "canvas", "geometry-canvas": "canvas",
  register: "record", "stat-tile": "tile", field: "field", label: "label",
};

const panelsOf = (s: Record<string, unknown>) => (Array.isArray(s["panels"]) ? s["panels"] : []) as Array<Record<string, unknown>>;
const isAtomComposed = (s: Record<string, unknown>) => panelsOf(s).length > 0 && panelsOf(s).every((p) => PANEL_PRIMITIVE[String(p["kind"])]);

/** The catalogue screens authored purely from atoms — every panel maps to a primitive family. */
const atomScreens = () => screenDefCatalogue().filter((s) => isAtomComposed(s as Record<string, unknown>));

test("every canonical methodology has an atom-composed overview screen in the catalogue", () => {
  const covered = new Set(atomScreens().flatMap((s) => ((s as Record<string, unknown>)["methodologies"] as string[]) ?? []));
  for (const m of methodologyCatalogue()) {
    assert.ok(covered.has(m.id), `methodology "${m.id}" has an atom-composed screen`);
  }
});

test("RENDER + CANONICAL MATCH: every panel of an atom-composed screen resolves to its expected tree root", () => {
  for (const s of atomScreens()) {
    for (const p of panelsOf(s as Record<string, unknown>)) {
      const kind = String(p["kind"]);
      const family = PANEL_PRIMITIVE[kind]!;
      const resolved = resolvePrimitive(family);
      assert.ok(resolved, `${s.id}: panel "${p["id"]}" family "${family}" resolves`);
      const root = resolved!.lineage.at(-1)!;
      assert.equal(getPrimitive(root)!.extends, undefined, `${s.id}: root "${root}" is a tree root`);
      assert.equal(root, EXPECTED_ROOT[family], `${s.id}: ${family} composes to the ${EXPECTED_ROOT[family]} tree`);
    }
  }
});

test("a visual panel is a canvas made specific; a data panel is a record made specific", () => {
  const chart = resolvePrimitive("chart")!;
  assert.equal(chart.lineage.at(-1), "canvas");
  assert.ok(chart.lineage.includes("geometry-canvas"), "a chart is a geometry-canvas made specific");
  assert.equal(resolvePrimitive("register")!.lineage.at(-1), "record");
});

test("every ancestor primitive an atom-composed screen needs is a shipped primitive def", () => {
  const shipped = new Set(primitiveCatalogue().map((p) => p.id));
  for (const s of atomScreens()) {
    for (const p of panelsOf(s as Record<string, unknown>)) {
      for (const anc of resolvePrimitive(PANEL_PRIMITIVE[String(p["kind"])]!)!.lineage) {
        assert.ok(shipped.has(anc), `ancestor "${anc}" (screen ${s.id}) is a shipped primitive`);
      }
    }
  }
});

test("NEGATIVE: a bespoke engine panel is not atom-composable, so its screen isn't in the atom set", () => {
  assert.equal(PANEL_PRIMITIVE["view"], undefined);
  assert.equal(PANEL_PRIMITIVE["component"], undefined);
  // scrum.json (kind "view") is a real catalogue screen but NOT atom-composed — it renders via the engine.
  assert.equal(isAtomComposed({ panels: [{ id: "x", kind: "view" }] }), false);
});
