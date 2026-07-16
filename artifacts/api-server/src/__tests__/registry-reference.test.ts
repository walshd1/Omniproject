import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadReferenceDesigns, referenceDesign, referenceDesignsForKind, referenceDesignsDir } from "../lib/registry-reference";
import { sanitizeRegistrySubmit } from "../lib/registry";
import { validateScreenDefs } from "../lib/screen-def";
import { validateForms } from "../lib/form-def";

/**
 * The published reference designs (roadmap 3.5, slice 2) — plain JSON files in the repo's `reference-designs/`
 * directory, loaded by lib/registry-reference. The guarantee we publish is that they're actually VALID: this
 * reads the FILES ON DISK, parses each, and holds it to the real submit sanitiser (and the screen/form
 * examples to the very validators the app enforces). A reference design can therefore never drift into a
 * shape the product would reject — and a malformed JSON file fails here in CI.
 */

test("the reference-designs directory exists and holds only valid JSON files", () => {
  const dir = referenceDesignsDir();
  assert.ok(dir, "the repo reference-designs/ directory is resolvable");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".json")) files.push(full);
    }
  };
  walk(dir!);
  assert.ok(files.length >= 3, "at least a few reference designs are published");
  for (const f of files) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(f, "utf8")), `${path.basename(f)} is valid JSON`);
  }
});

test("every loaded reference example is a valid registry submission; slugs are unique", () => {
  const designs = loadReferenceDesigns();
  assert.ok(designs.length >= 3);
  const slugs = designs.map((d) => d.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs are unique");
  for (const design of designs) {
    const clean = sanitizeRegistrySubmit(design.example);
    assert.equal(clean.kind, design.kind, `${design.slug}: example kind matches the loaded kind`);
    assert.equal(clean.name, design.example.name);
    assert.ok(typeof clean.payload === "object" && clean.payload !== null, `${design.slug}: payload is an object`);
    assert.ok(design.notes.length > 0, `${design.slug}: carries teaching notes`);
  }
});

test("the screen example passes the real screen-def validator", () => {
  const screen = loadReferenceDesigns().find((d) => d.slug === "delivery-health")!;
  const defs = validateScreenDefs([screen.example.payload]);
  assert.equal(defs[0]!.id, "delivery-health");
  assert.equal(defs[0]!.panels.length, 2);
});

test("the form example passes the real form-def validator", () => {
  const form = loadReferenceDesigns().find((d) => d.slug === "change-request")!;
  const defs = validateForms([form.example.payload]);
  assert.equal(defs[0]!.id, "change-request");
  assert.equal(defs[0]!.fields.filter((f) => f.mapTo === "title").length, 1);
});

test("referenceDesign + referenceDesignsForKind look items up", () => {
  assert.equal(referenceDesign("grouped-column")!.kind, "primitive");
  assert.equal(referenceDesign("nope"), null);
  assert.ok(referenceDesignsForKind("form").length >= 1);
});
