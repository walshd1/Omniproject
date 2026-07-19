import test from "node:test";
import assert from "node:assert/strict";
import { methodologyArtifacts, PANEL_PRIMITIVE } from "./methodology-artifacts";
import { methodologyCatalogue } from "./methodology-catalogue";
import { resolvePrimitive, getPrimitive } from "./primitive-catalogue";

/**
 * THE PROOF: every canonical methodology can have its overview artifact BUILT FROM THE ATOMS — a
 * screen (a canvas + panels) whose every panel renders through a catalogued primitive that composes
 * down to a tree root. If any panel used a bespoke escape hatch, its kind wouldn't be in
 * PANEL_PRIMITIVE and this fails; if a primitive didn't compose to a root, resolvePrimitive would show
 * it. These recipes are what gets seeded into the system store.
 */

// Each panel-family primitive must bottom out at the RIGHT tree root: visuals → canvas, data → record,
// and the cross-cutting atoms at their own root.
const EXPECTED_ROOT: Record<string, string> = {
  chart: "canvas",
  table: "canvas",
  form: "canvas",
  "geometry-canvas": "canvas",
  register: "record",
  "stat-tile": "tile",
  field: "field",
  label: "label",
};

test("every canonical methodology has an overview artifact recipe", () => {
  const arts = methodologyArtifacts();
  const covered = new Set(arts.flatMap((a) => (a["methodologies"] as string[]) ?? []));
  for (const m of methodologyCatalogue()) {
    assert.ok(covered.has(m.id), `methodology "${m.id}" has a canonical artifact`);
  }
});

test("every artifact is composed ENTIRELY from atom-resolvable panels (no bespoke escape hatches)", () => {
  for (const a of methodologyArtifacts()) {
    const panels = a["panels"] as Array<Record<string, unknown>>;
    assert.ok(panels.length > 0, `${a.id} has panels`);
    for (const panel of panels) {
      const kind = String(panel["kind"]);
      const primId = PANEL_PRIMITIVE[kind];
      assert.ok(primId, `${a.id}: panel "${panel["id"]}" kind "${kind}" maps to a primitive family`);
      const resolved = resolvePrimitive(primId!);
      assert.ok(resolved, `${primId} resolves against the catalogue`);
      // It composes down to the expected tree root — proof it's built from the atoms.
      const root = resolved!.lineage.at(-1)!;
      assert.equal(getPrimitive(root)!.extends, undefined, `${primId} bottoms out at a root`);
      assert.equal(root, EXPECTED_ROOT[primId], `${primId} composes to the ${EXPECTED_ROOT[primId]} tree`);
    }
  }
});

test("the visual panels are a canvas made specific (screen = canvas + panels)", () => {
  // Spot-check the composition backbone the recipes rely on.
  assert.equal(resolvePrimitive("screen")!.lineage.at(-1), "canvas");
  assert.equal(resolvePrimitive("chart")!.lineage.at(-1), "canvas");
  assert.equal(resolvePrimitive("table")!.lineage.at(-1), "canvas");
});
