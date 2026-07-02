import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_REGISTRY } from "../lib/field-registry";
import { validateEntityInput } from "../lib/field-registry";
import { SAMPLE_STAKEHOLDERS, SAMPLE_RACI, SAMPLE_RAID } from "../broker/demo-data";

/**
 * Governance demo-data guard — the Phase 3 stakeholder register, RACI matrix and
 * risk-register extension of RAID are only useful if the canned sample data matches
 * the canonical field vocabulary they are gated by. These tests bind the demo rows
 * to the registry so a field rename can't silently leave the demo dataset stale.
 */

const descriptorsFor = (entity: string) => FIELD_REGISTRY.filter((f) => f.entity === entity);

test("stakeholder demo rows satisfy the canonical stakeholder field descriptors", () => {
  const descriptors = descriptorsFor("stakeholder");
  assert.ok(descriptors.some((d) => d.key === "stakeholderName" && d.required), "stakeholderName is a required stakeholder field");
  const rows = Object.values(SAMPLE_STAKEHOLDERS).flat();
  assert.ok(rows.length > 0, "there is stakeholder demo data");
  for (const row of rows) {
    assert.deepEqual(validateEntityInput(row as Record<string, unknown>, descriptors), [], `stakeholder ${(row as { id?: string }).id} is valid`);
  }
});

test("RACI demo rows satisfy the canonical raci field descriptors (one Accountable per deliverable)", () => {
  const descriptors = descriptorsFor("raci");
  assert.ok(descriptors.some((d) => d.key === "deliverable" && d.required), "deliverable is a required raci field");
  const rows = Object.values(SAMPLE_RACI).flat();
  assert.ok(rows.length > 0, "there is RACI demo data");
  for (const row of rows) {
    assert.deepEqual(validateEntityInput(row as Record<string, unknown>, descriptors), [], `raci ${(row as { id?: string }).id} is valid`);
    // RACI invariant: exactly one Accountable person per deliverable.
    assert.equal(typeof (row as { raciAccountable?: unknown }).raciAccountable, "string");
  }
});

test("risk-register fields extend RAID rows without duplicating the log", () => {
  // The risk-register fields live on the SAME raid entity — a risk entry carries the
  // quantitative fields; a non-risk RAID entry simply omits them.
  const riskFields = FIELD_REGISTRY.filter((f) => f.group === "risk");
  assert.deepEqual(riskFields.map((f) => f.key).sort(), ["probability", "responseStrategy", "riskExposure"]);
  assert.ok(riskFields.every((f) => f.entity === "raid"), "risk fields are scoped to the raid entity");
  const risks = Object.values(SAMPLE_RAID).flat().filter((r) => (r as { type?: string }).type === "risk");
  assert.ok(risks.length > 0, "there are demo risks");
  for (const r of risks) {
    const row = r as Record<string, unknown>;
    assert.equal(typeof row["probability"], "string", "a demo risk has a probability rating");
    assert.equal(typeof row["riskExposure"], "number", "a demo risk carries an exposure score");
    assert.equal(typeof row["responseStrategy"], "string", "a demo risk names a response strategy");
  }
});
