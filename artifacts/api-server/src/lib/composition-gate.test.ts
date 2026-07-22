import { test } from "node:test";
import assert from "node:assert/strict";
import { outputForPath } from "./composition-gate";

/**
 * The output-gate path→output mapping (re-land of pass-2 P2). Express serves `/METRICS` and `/metrics/`
 * to the same handler (case-insensitive, non-strict routing), so the gate must recognise those variants
 * too — otherwise a case/trailing-slash variant reaches the output while slipping past this gate's
 * case-sensitive, `$`-anchored patterns (a hard-gate bypass).
 */

test("maps the canonical output paths", () => {
  assert.equal(outputForPath("/metrics"), "metrics");
  assert.equal(outputForPath("/odata/Projects"), "odata");
  assert.equal(outputForPath("/calendar.ics"), "ical");
  assert.equal(outputForPath("/export.csv"), "exports");
  assert.equal(outputForPath("/mcp"), "mcp");
  assert.equal(outputForPath("/notifications/stream"), "notifications-stream");
  assert.equal(outputForPath("/whoami"), null);
});

test("case + trailing-slash variants map the SAME output (no gate bypass)", () => {
  assert.equal(outputForPath("/METRICS"), "metrics");
  assert.equal(outputForPath("/metrics/"), "metrics");
  assert.equal(outputForPath("/Metrics/"), "metrics");
  assert.equal(outputForPath("/OData/Projects"), "odata");
  assert.equal(outputForPath("/MCP"), "mcp");
  assert.equal(outputForPath("/CALENDAR.ICS"), "ical");
  assert.equal(outputForPath("/notifications/stream/"), "notifications-stream");
});
