import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPlaneEntry } from "./plane-verifier";
import { BACKENDS } from "./backend-catalogue";
import { BROKERS } from "./broker-catalogue";
import { OUTPUTS } from "./output-catalogue";
import { NOTIFICATIONS } from "./notification-catalogue";
import { METHODOLOGIES } from "./methodology-catalogue";
import { REPORTS } from "./report-catalogue";
import { SCREENS } from "./screen-catalogue";

test("every SHIPPED entry passes its own plane verifier (verifier ↔ registries can't drift)", () => {
  const planes: [string, unknown[]][] = [
    ["backends", BACKENDS], ["brokers", BROKERS], ["outputs", OUTPUTS], ["notifications", NOTIFICATIONS],
    ["methodologies", METHODOLOGIES], ["reports", REPORTS], ["screens", SCREENS],
  ];
  for (const [plane, entries] of planes) {
    for (const e of entries) {
      const r = verifyPlaneEntry(plane, e);
      assert.ok(r.ok, `${plane}/${(e as { id: string }).id} failed: ${r.errors.join("; ")}`);
    }
  }
});

test("a well-formed new entry passes; missing fields are reported", () => {
  const good = { id: "acme", label: "Acme", route: "/api/acme", kind: "read-api", capabilities: { readOnly: true, streaming: false, auth: "api-token" }, tools: ["x"] };
  assert.equal(verifyPlaneEntry("outputs", good).ok, true);

  const bad = verifyPlaneEntry("outputs", { id: "acme" }); // missing label/route/kind/caps/tools
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes("label")) && bad.errors.some((e) => e.includes("route")));
});

test("plane-specific invariants are enforced (broker.synchronous, report.requiresCapability, screen.requiresRole)", () => {
  assert.ok(verifyPlaneEntry("brokers", { id: "b", label: "B", kind: "low-code", capabilities: {}, transports: [], build: "x" }).errors.some((e) => e.includes("synchronous")));
  assert.ok(verifyPlaneEntry("reports", { id: "r", label: "R", kind: "progress", capabilities: {}, tools: [] }).errors.some((e) => e.includes("requiresCapability")));
  assert.ok(verifyPlaneEntry("screens", { id: "s", label: "S", route: "/x", kind: "detail", capabilities: { requiresRole: "wizard" }, tools: [] }).errors.some((e) => e.includes("requiresRole")));
});

test("unknown plane + cross-plane reference checks", () => {
  assert.equal(verifyPlaneEntry("nope", {}).ok, false);
  const r = verifyPlaneEntry("brokers", { id: "b", label: "B", kind: "low-code", capabilities: { synchronous: true }, transports: ["http"], build: "x", alsoProvides: [{ plane: "made-up" }] });
  assert.ok(r.ok); // alsoProvides typo is a warning, not an error
  assert.ok(r.warnings.some((w) => w.includes("made-up")));
});
