import { test } from "node:test";
import assert from "node:assert/strict";
import { REGISTRY_ITEM_KINDS, REGISTRY_APPROVAL_STATUSES, REGISTRY_VISIBILITIES, registryItemKindLabel } from "./registry-catalogue";

/** The org-registry catalogue — the source of truth for the `registryItem` primitive family. */

test("the closed sets the primitive family + flow draw from", () => {
  assert.deepEqual([...REGISTRY_ITEM_KINDS], ["template", "report", "primitive", "plugin", "screen", "dashboard", "form", "jsonDef"]);
  assert.deepEqual([...REGISTRY_APPROVAL_STATUSES], ["draft", "approved", "rejected"]);
  assert.deepEqual([...REGISTRY_VISIBILITIES], ["internal", "community"]);
});

test("registryItemKindLabel is human-readable", () => {
  assert.equal(registryItemKindLabel("template"), "Template");
  assert.equal(registryItemKindLabel("jsonDef"), "JSON definition");
  assert.equal(registryItemKindLabel("primitive"), "Primitive");
});
