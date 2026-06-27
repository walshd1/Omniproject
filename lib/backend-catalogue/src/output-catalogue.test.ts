import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTPUTS, outputCatalogue, getOutput } from "./output-catalogue";

test("the output registry lists the outward interfaces with capabilities + tools", () => {
  const ids = OUTPUTS.map((o) => o.id);
  for (const expected of ["mcp", "odata", "metrics", "exports", "webhooks"]) {
    assert.ok(ids.includes(expected), `missing output ${expected}`);
  }
  for (const o of OUTPUTS) {
    assert.ok(o.label && o.route && o.kind, `${o.id} missing fields`);
    assert.ok(Array.isArray(o.tools), `${o.id} tools must be a list`);
    assert.ok(typeof o.capabilities.readOnly === "boolean");
  }
});

test("capabilities and tools are separate but linked per output", () => {
  const mcp = getOutput("mcp");
  assert.equal(mcp?.kind, "agent-api");
  assert.equal(mcp?.capabilities.readOnly, true);
  assert.ok(mcp?.tools.includes("omniproject_list_projects"));
});

test("most outputs are read-only; outbound/inbound events are the writes", () => {
  const cat = outputCatalogue();
  assert.equal(cat.find((o) => o.id === "exports")?.capabilities.readOnly, true);
  assert.equal(cat.find((o) => o.id === "webhooks")?.capabilities.readOnly, false);
  assert.equal(cat.find((o) => o.id === "webhooks")?.kind, "events-out");
});
