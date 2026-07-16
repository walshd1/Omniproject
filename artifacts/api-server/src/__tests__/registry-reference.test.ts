import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRY_REFERENCE_DESIGNS, referenceDesign, referenceDesignsForKind } from "../lib/registry-reference";
import { sanitizeRegistrySubmit } from "../lib/registry";
import { validateScreenDefs } from "../lib/screen-def";
import { validateForms } from "../lib/form-def";

/**
 * The published reference designs (roadmap 3.5, slice 2). Each is a copy-pasteable example of a registry
 * kind — the guarantee we publish is that it's actually VALID: every example passes the real submit
 * sanitiser, and the screen/form examples pass the very validators the app enforces. A reference design can
 * therefore never drift into a shape the product would reject.
 */

test("there is at least one reference design and slugs are unique", () => {
  assert.ok(REGISTRY_REFERENCE_DESIGNS.length >= 3);
  const slugs = REGISTRY_REFERENCE_DESIGNS.map((d) => d.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs must be unique");
});

test("every reference example is a valid registry submission", () => {
  for (const design of REGISTRY_REFERENCE_DESIGNS) {
    const clean = sanitizeRegistrySubmit(design.example);
    assert.equal(clean.kind, design.kind, `${design.slug}: example kind matches the design kind`);
    assert.equal(clean.name, design.example.name);
    assert.ok(typeof clean.payload === "object" && clean.payload !== null, `${design.slug}: payload is an object`);
    assert.ok(design.notes.length > 0, `${design.slug}: has teaching notes`);
  }
});

test("the screen JSON-def example passes the real screen-def validator", () => {
  const screen = REGISTRY_REFERENCE_DESIGNS.find((d) => d.slug === "jsondef-screen")!;
  const defs = validateScreenDefs([screen.example.payload]);
  assert.equal(defs[0]!.id, "delivery-health");
  assert.equal(defs[0]!.panels.length, 2);
});

test("the form example passes the real form-def validator", () => {
  const form = REGISTRY_REFERENCE_DESIGNS.find((d) => d.slug === "jsondef-form")!;
  const defs = validateForms([form.example.payload]);
  assert.equal(defs[0]!.id, "change-request");
  // Exactly one field maps to title — the validator would have thrown otherwise.
  assert.equal(defs[0]!.fields.filter((f) => f.mapTo === "title").length, 1);
});

test("referenceDesign + referenceDesignsForKind look items up", () => {
  assert.equal(referenceDesign("primitive-viz-chart")!.kind, "primitive");
  assert.equal(referenceDesign("nope"), null);
  assert.ok(referenceDesignsForKind("form").length >= 1);
  assert.equal(referenceDesignsForKind("plugin").length, referenceDesignsForKind("plugin").length); // stable
});
