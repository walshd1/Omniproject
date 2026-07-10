import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGating,
  buildSelfHostCapability,
  roleForMode,
  type GatingInput,
} from "./capability-gating";
import { domainById } from "./domains";

const base: GatingInput = { mode: "system-of-record", org: {} };

test("mode maps to the composition role", () => {
  assert.equal(roleForMode("system-of-record"), "authoritative");
  assert.equal(roleForMode("augmenting"), "augmenting");
});

test("off mode disables every domain regardless of adoption", () => {
  const g = resolveGating({ mode: "off", org: { adopted: ["financials", "quality"] } });
  assert.equal(g.enabledDomainIds.size, 0);
  assert.ok(g.rows.every((r) => !r.enabled));
});

test("core domain (issues) is on without any opt-in; gated domains need adoption", () => {
  const g = resolveGating(base);
  assert.ok(g.enabledDomainIds.has("issues"), "core issues is always on");
  assert.ok(!g.enabledDomainIds.has("financials"), "financials is default-off until adopted");
});

test("adopting a gated domain at org turns it on", () => {
  const g = resolveGating({ mode: "system-of-record", org: { adopted: ["financials"] } });
  assert.ok(g.enabledDomainIds.has("financials"));
});

test("a programme disable narrows an org-adopted domain off for that scope", () => {
  const g = resolveGating({
    mode: "system-of-record",
    org: { adopted: ["financials"] },
    programme: { disabled: ["financials"] },
  });
  const row = g.rows.find((r) => r.id === "financials")!;
  assert.equal(row.enabled, false);
  assert.equal(row.blockedAt, "programme");
});

test("a PMO org forbid locks a domain off — descendants can't re-enable it", () => {
  const g = resolveGating({
    mode: "system-of-record",
    org: { adopted: ["financials"], forbidden: ["financials"] },
    project: { required: ["financials"] },
  });
  const row = g.rows.find((r) => r.id === "financials")!;
  assert.equal(row.enabled, false);
  assert.equal(row.locked, true);
  assert.equal(row.lockedBy, "org");
  assert.equal(row.policy, "forbid");
});

test("buildSelfHostCapability surfaces+stores exactly the enabled domains' fields", () => {
  const g = resolveGating({ mode: "system-of-record", org: { adopted: ["financials"] } });
  const cap = buildSelfHostCapability(g);
  assert.equal(cap.role, "authoritative");
  // an issues (core) field and a financials field are present...
  assert.deepEqual(cap.fields["title"], { surface: true, store: true });
  assert.deepEqual(cap.fields["budget"], { surface: true, store: true });
  // ...a non-adopted domain's field is absent.
  const qualityField = domainById("quality").fields[0]!.key;
  assert.equal(cap.fields[qualityField], undefined);
});

test("buildSelfHostCapability in off mode yields an empty capability", () => {
  const g = resolveGating({ mode: "off", org: { adopted: ["financials"] } });
  const cap = buildSelfHostCapability(g);
  assert.deepEqual(cap.fields, {});
});

test("an augmenting store advertises the augmenting role", () => {
  const g = resolveGating({ mode: "augmenting", org: { adopted: ["quality"] } });
  const cap = buildSelfHostCapability(g);
  assert.equal(cap.role, "augmenting");
});

test("gating exposes one row per domain with metadata", () => {
  const rows = resolveGating(base).rows;
  assert.equal(rows.length, 9);
  const issues = rows.find((r) => r.id === "issues")!;
  assert.equal(issues.core, true);
  assert.ok(issues.fieldCount > 0);
  assert.equal(issues.unlocks, domainById("issues").unlocks);
});
