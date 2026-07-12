import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFieldRouting, routeSourceKey, FieldRoutingError } from "./field-routing";

const route = (over: Partial<{ uiElement: string; vendor: string; broker: string; sourceField: string }> = {}) => ({
  uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate", ...over,
});

test("accepts a well-formed, collision-free map and trims the fields", () => {
  const ok = validateFieldRouting([
    { uiElement: " dueDate ", vendor: " jira ", broker: " n8n ", sourceField: " duedate " },
    route({ uiElement: "budget", vendor: "sql", sourceField: "budget_amount" }),
  ]);
  assert.equal(ok.length, 2);
  assert.deepEqual(ok[0], { uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate" });
});

test("anti-collision: two sources cannot feed the SAME UI element", () => {
  assert.throws(
    () => validateFieldRouting([route(), route({ vendor: "sql", sourceField: "due" })]), // same uiElement dueDate
    (e: unknown) => e instanceof FieldRoutingError && /already mapped/.test((e as Error).message),
  );
});

test("anti-collision: the SAME source cannot drive two UI elements", () => {
  assert.throws(
    () => validateFieldRouting([route(), route({ uiElement: "startDate" })]), // same jira·n8n·duedate source
    (e: unknown) => e instanceof FieldRoutingError && /already routed/.test((e as Error).message),
  );
});

test("a source differing by ANY of vendor/broker/sourceField is a distinct source (no false collision)", () => {
  const ok = validateFieldRouting([
    { uiElement: "a", vendor: "jira", broker: "n8n", sourceField: "f" },
    { uiElement: "b", vendor: "jira", broker: "make", sourceField: "f" }, // different broker
    { uiElement: "c", vendor: "sql", broker: "n8n", sourceField: "f" }, // different vendor
    { uiElement: "d", vendor: "jira", broker: "n8n", sourceField: "g" }, // different column
  ]);
  assert.equal(ok.length, 4);
});

test("rejects bad shapes: not an array, non-object entries, missing/empty parts", () => {
  assert.throws(() => validateFieldRouting({} as unknown), FieldRoutingError);
  assert.throws(() => validateFieldRouting(["nope"]), FieldRoutingError);
  assert.throws(() => validateFieldRouting([route({ vendor: "" })]), FieldRoutingError);
  assert.throws(() => validateFieldRouting([route({ uiElement: "  " })]), FieldRoutingError);
});

test("routeSourceKey combines vendor·broker·sourceField (the identifying source key)", () => {
  assert.equal(routeSourceKey({ vendor: "jira", broker: "n8n", sourceField: "duedate" }), routeSourceKey({ vendor: "jira", broker: "n8n", sourceField: "duedate" }));
  assert.notEqual(routeSourceKey({ vendor: "jira", broker: "n8n", sourceField: "a" }), routeSourceKey({ vendor: "jira", broker: "n8n", sourceField: "b" }));
});
