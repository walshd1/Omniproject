import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, type JsonSchema } from "./vendor-schema";
import type { DrillTo } from "./drill-to";

/**
 * The `drillTo` JSON-schema fragment is hand-duplicated across report.schema.json and
 * widget.schema.json (the minimal validator has no $ref/$defs support — see vendor-schema.ts). These
 * tests exercise both copies against the same descriptors so the two never silently drift apart, and
 * pin the descriptor shape a report/widget JSON file is expected to author.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "../assets/schema");
function loadSchema(file: string): JsonSchema {
  return JSON.parse(fs.readFileSync(path.join(ASSETS, file), "utf8")) as JsonSchema;
}
/** Pull the `drillTo` sub-schema out of a loaded report/widget schema. */
function drillToSchema(schema: JsonSchema): JsonSchema {
  const properties = schema["properties"] as Record<string, JsonSchema>;
  return properties["drillTo"]!;
}
const reportSchema = drillToSchema(loadSchema("report.schema.json"));
const widgetSchema = drillToSchema(loadSchema("widget.schema.json"));

const BLOCKED_DRILL: DrillTo = {
  target: "grid",
  projectIdField: "projectId",
  predicate: { all: [{ field: "blocked", op: "truthy" }] },
  label: "Blocked items",
};

const WITH_PREDICATE_FROM: DrillTo = {
  target: "grid",
  predicateFrom: [{ field: "assignee", op: "eq", fromField: "owner" }],
};

for (const [schemaName, schema] of [["report", reportSchema], ["widget", widgetSchema]] as const) {
  test(`${schemaName}.schema.json accepts a well-formed drillTo (static predicate)`, () => {
    const errs = validate(schema, BLOCKED_DRILL);
    assert.deepEqual(errs, []);
  });

  test(`${schemaName}.schema.json accepts a well-formed drillTo (predicateFrom)`, () => {
    const errs = validate(schema, WITH_PREDICATE_FROM);
    assert.deepEqual(errs, []);
  });

  test(`${schemaName}.schema.json rejects a drillTo missing "target"`, () => {
    const errs = validate(schema, { predicate: { all: [] } });
    assert.ok(errs.some((e) => e.includes("target")));
  });

  test(`${schemaName}.schema.json rejects an unknown drillTo target`, () => {
    const errs = validate(schema, { target: "board" });
    assert.ok(errs.length > 0);
  });

  test(`${schemaName}.schema.json rejects an unknown property inside a drillTo condition`, () => {
    const errs = validate(schema, {
      target: "grid",
      predicate: { all: [{ field: "blocked", op: "truthy", bogus: true }] },
    });
    assert.ok(errs.some((e) => e.includes("bogus")));
  });
}
