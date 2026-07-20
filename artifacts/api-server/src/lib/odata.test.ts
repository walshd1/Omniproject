import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEdmx,
  serviceDocument,
  applyODataQuery,
  entitySetEnvelope,
  ODATA_MAX_PAGE,
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

test("server-driven paging caps every page at ODATA_MAX_PAGE and signals more via nextSkip", () => {
  const rows: Row[] = Array.from({ length: ODATA_MAX_PAGE + 25 }, (_, i) => ({ id: String(i) }));
  // No $top: the response is bounded to the max page (no silent whole-corpus dump) and points on.
  const first = applyODataQuery(rows, {});
  assert.equal(first.rows.length, ODATA_MAX_PAGE);
  assert.equal(first.nextSkip, ODATA_MAX_PAGE);
  // The next page starts at nextSkip and, being the last, carries no further nextSkip.
  const second = applyODataQuery(rows, { $skip: String(first.nextSkip) });
  assert.equal(second.rows.length, 25);
  assert.equal(second.nextSkip, undefined);
  // A caller $top is honoured but still clamped to the max.
  assert.equal(applyODataQuery(rows, { $top: "5" }).rows.length, 5);
  assert.equal(applyODataQuery(rows, { $top: String(ODATA_MAX_PAGE + 500) }).rows.length, ODATA_MAX_PAGE);
});

test("nextLink is emitted in the envelope only when a page was capped", () => {
  const capped = entitySetEnvelope("https://x/odata/", "Issues", [{ id: "1" }], 100, "https://x/odata/Issues?$skip=1000");
  assert.equal(capped["@odata.nextLink"], "https://x/odata/Issues?$skip=1000");
  const full = entitySetEnvelope("https://x/odata/", "Issues", [{ id: "1" }], 1);
  assert.ok(!("@odata.nextLink" in full));
});

test("projection strips un-modeled fields (allowed list) and $select can't pull them back", () => {
  const dirty = [{ id: "1", title: "A", secretInternal: "x", assigneeEmailPII: "a@b.c" }];
  const allowed = ["id", "title", "status"];
  // Default (no $select): only modeled props survive.
  const def = applyODataQuery(dirty, {}, allowed).rows[0]!;
  assert.deepEqual(Object.keys(def).sort(), ["id", "status", "title"]);
  assert.equal("secretInternal" in def, false);
  assert.equal("assigneeEmailPII" in def, false);
  // $select an un-modeled field: it is intersected with the model, so the leak field is dropped.
  const sel = applyODataQuery(dirty, { $select: "id,secretInternal" }, allowed).rows[0]!;
  assert.deepEqual(Object.keys(sel), ["id"]);
});
