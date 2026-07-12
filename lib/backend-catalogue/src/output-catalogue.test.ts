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

test("calendar outputs publish scheduled work over the connection method(s) they declare", () => {
  const cat = outputCatalogue();
  const calendars = cat.filter((o) => o.kind === "calendar");
  assert.deepEqual(calendars.map((o) => o.id).sort(), ["google-calendar", "ical", "outlook-calendar"]);

  // Google/Outlook are OAuth2 outbound pushes offered over BOTH the REST API and an MCP server.
  for (const id of ["google-calendar", "outlook-calendar"]) {
    const c = getOutput(id)!;
    assert.equal(c.capabilities.auth, "oauth2");
    assert.equal(c.capabilities.readOnly, false, `${id} writes events out`);
    assert.deepEqual(c.transports, ["api", "mcp"]);
  }

  // iCal is a read-only subscription feed OmniProject serves (its own route), not an outbound push.
  const ics = getOutput("ical")!;
  assert.equal(ics.capabilities.readOnly, true);
  assert.deepEqual(ics.transports, ["ical-feed"]);
  assert.match(ics.route, /\.ics$/);
});
