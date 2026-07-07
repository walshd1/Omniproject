import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEdmx,
  serviceDocument,
  applyODataQuery,
  entitySetEnvelope,
  type EntityModel,
  type Row,
} from "./odata";

/**
 * Minimal, dependency-free OData v4 helpers — $metadata, the service document, an in-memory
 * query engine ($filter/$select/$top/$skip/$orderby/$count), and the entity-set envelope.
 */
const entities: EntityModel[] = [
  { name: "Project", set: "Projects", key: "id", props: { id: "Edm.String", name: "Edm.String", budget: "Edm.Double", active: "Edm.Boolean" } },
];

test("buildEdmx describes entity types + sets and escapes XML-special names", () => {
  const withSpecial: EntityModel[] = [
    { name: "Issue", set: "Issues", key: "id", props: { id: "Edm.String", "a<b>&\"c": "Edm.String" } },
  ];
  const edmx = buildEdmx(withSpecial, "NS");
  assert.match(edmx, /<EntityType Name="Issue">/);
  assert.match(edmx, /<EntitySet Name="Issues" EntityType="NS\.Issue"\/>/);
  assert.match(edmx, /Name="a&lt;b&gt;&amp;&quot;c"/); // escaped
});

test("serviceDocument lists entity sets against the metadata context", () => {
  const doc = serviceDocument(entities, "https://x/odata/");
  assert.equal(doc["@odata.context"], "https://x/odata/$metadata");
  assert.deepEqual(doc.value, [{ name: "Projects", kind: "EntitySet", url: "Projects" }]);
});

const rows: Row[] = [
  { id: "1", name: "Apollo", budget: 100, active: true },
  { id: "2", name: "borealis", budget: 50, active: false },
  { id: "3", name: "Cronus", budget: 75 }, // budget-only sort has a value; name present
  { id: "4", name: "Delta" }, // no budget → sorts to the end on a budget orderby
];

test("$filter eq matches strings, numbers and booleans (coerced)", () => {
  assert.deepEqual(applyODataQuery(rows, { $filter: "name eq 'Apollo'" }).rows.map((r) => r.id), ["1"]);
  assert.deepEqual(applyODataQuery(rows, { $filter: "budget eq 50" }).rows.map((r) => r.id), ["2"]);
  assert.deepEqual(applyODataQuery(rows, { $filter: "active eq false" }).rows.map((r) => r.id), ["2"]);
  assert.deepEqual(applyODataQuery(rows, { $filter: "active eq true" }).rows.map((r) => r.id), ["1"]);
});

test("$filter with an escaped quote inside a literal is coerced correctly", () => {
  const q = applyODataQuery([{ id: "1", name: "O'Brien" }], { $filter: "name eq 'O''Brien'" });
  assert.deepEqual(q.rows.map((r) => r.id), ["1"]);
});

test("$filter contains is case-insensitive; an unsupported filter keeps all rows", () => {
  assert.deepEqual(applyODataQuery(rows, { $filter: "contains(name,'o')" }).rows.map((r) => r.id), ["1", "2", "3"]);
  assert.equal(applyODataQuery(rows, { $filter: "budget gt 60" }).rows.length, rows.length); // permissive
});

test("$orderby sorts asc/desc and always pushes missing values to the end", () => {
  const asc = applyODataQuery(rows, { $orderby: "budget asc" }).rows.map((r) => r.id);
  assert.deepEqual(asc, ["2", "3", "1", "4"]); // 50,75,100, then missing
  const desc = applyODataQuery(rows, { $orderby: "budget desc" }).rows.map((r) => r.id);
  assert.deepEqual(desc, ["1", "3", "2", "4"]); // 100,75,50, missing still last
});

test("$orderby on strings uses localeCompare (default asc when no direction given)", () => {
  const out = applyODataQuery(rows, { $orderby: "name" }).rows.map((r) => r.name);
  assert.deepEqual(out, ["Apollo", "borealis", "Cronus", "Delta"]);
});

test("$orderby on booleans orders false before true", () => {
  const out = applyODataQuery(rows.slice(0, 2), { $orderby: "active asc" }).rows.map((r) => r.id);
  assert.deepEqual(out, ["2", "1"]); // false, true
});

test("$orderby on heterogeneous/equal values preserves stable order", () => {
  const mixed: Row[] = [{ id: "a", v: 1 }, { id: "b", v: "x" }, { id: "c", v: 1 }];
  const out = applyODataQuery(mixed, { $orderby: "v asc" }).rows.map((r) => r.id);
  assert.deepEqual(out, ["a", "b", "c"]); // incomparable types treated as equal → original order
});

test("$skip and $top page the result set; non-numeric/negative are ignored", () => {
  assert.deepEqual(applyODataQuery(rows, { $skip: "2" }).rows.map((r) => r.id), ["3", "4"]);
  assert.deepEqual(applyODataQuery(rows, { $top: "2" }).rows.map((r) => r.id), ["1", "2"]);
  assert.deepEqual(applyODataQuery(rows, { $skip: "0", $top: "0" }).rows, []); // top 0 → none
  assert.deepEqual(applyODataQuery(rows, { $skip: "not-a-number", $top: "-5" }).rows.length, rows.length);
});

test("$select projects only the named fields", () => {
  const out = applyODataQuery(rows, { $select: "id, name" }).rows;
  assert.deepEqual(out[0], { id: "1", name: "Apollo" });
});

test("$count=true reports the pre-paging total alongside the paged rows", () => {
  const res = applyODataQuery(rows, { $top: "1", $count: "true" });
  assert.equal(res.count, 4);
  assert.equal(res.rows.length, 1);
  // Without $count the field is absent.
  assert.equal(applyODataQuery(rows, { $top: "1" }).count, undefined);
});

test("entitySetEnvelope wraps rows and includes @odata.count only when provided", () => {
  const withCount = entitySetEnvelope("https://x/odata/", "Projects", rows, 4);
  assert.equal(withCount["@odata.context"], "https://x/odata/$metadata#Projects");
  assert.equal(withCount["@odata.count"], 4);

  const withoutCount = entitySetEnvelope("https://x/odata/", "Projects", rows);
  assert.ok(!("@odata.count" in withoutCount));
});
