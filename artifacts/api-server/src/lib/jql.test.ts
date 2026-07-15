import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJql, runJql, JqlError } from "./jql";

const rows = [
  { id: "1", title: "Login bug", status: "open", priority: "high", storyPoints: 5, assignee: "ada", labels: ["auth", "ui"] },
  { id: "2", title: "Signup flow", status: "in_progress", priority: "medium", storyPoints: 8, assignee: "bob", epic: "EPIC-1" },
  { id: "3", title: "Logout crash", status: "done", priority: "high", storyPoints: 2, assignee: "ada" },
  { id: "4", title: "Nav polish", status: "open", priority: "low", storyPoints: null, assignee: "" },
];
const ids = (q: string) => runJql(rows, q).map((r) => r["id"]);

test("equality is case-insensitive; numbers and booleans coerce", () => {
  assert.deepEqual(ids("status = OPEN"), ["1", "4"]);
  assert.deepEqual(ids("storyPoints = 8"), ["2"]);
});

test("!= excludes matches (and includes rows missing the field)", () => {
  assert.deepEqual(ids("status != open"), ["2", "3"]);
});

test("comparison operators work numerically", () => {
  assert.deepEqual(ids("storyPoints >= 5"), ["1", "2"]);
  assert.deepEqual(ids("storyPoints < 5"), ["3"]); // row 4's null is not < 5
});

test("~ is a case-insensitive contains; !~ is its negation", () => {
  assert.deepEqual(ids("title ~ log"), ["1", "3"]); // Login, Logout
  assert.deepEqual(ids("title !~ log"), ["2", "4"]);
});

test("IN / NOT IN over a list", () => {
  assert.deepEqual(ids("priority IN (high, low)"), ["1", "3", "4"]);
  assert.deepEqual(ids("priority NOT IN (high)"), ["2", "4"]);
});

test("IS EMPTY / IS NOT EMPTY (null, missing and '' all count as empty)", () => {
  assert.deepEqual(ids("epic IS EMPTY"), ["1", "3", "4"]);
  assert.deepEqual(ids("epic IS NOT EMPTY"), ["2"]);
  assert.deepEqual(ids("assignee IS EMPTY"), ["4"]); // "" is empty
});

test("AND binds tighter than OR; parentheses override", () => {
  // high AND (open) OR done  ==  (high AND open) OR done
  assert.deepEqual(ids("priority = high AND status = open OR status = done"), ["1", "3"]);
  assert.deepEqual(ids("priority = high AND (status = open OR status = done)"), ["1", "3"]);
  assert.deepEqual(ids("(priority = high OR priority = low) AND status = open"), ["1", "4"]);
});

test("NOT negates", () => {
  assert.deepEqual(ids("NOT status = open"), ["2", "3"]);
  assert.deepEqual(ids("NOT (priority = high)"), ["2", "4"]);
});

test("ORDER BY sorts asc/desc with missing values last; multi-key + limit", () => {
  assert.deepEqual(runJql(rows, "ORDER BY storyPoints desc").map((r) => r["id"]), ["2", "1", "3", "4"]); // null last
  assert.deepEqual(runJql(rows, "ORDER BY storyPoints asc").map((r) => r["id"]), ["3", "1", "2", "4"]);
  assert.deepEqual(runJql(rows, "status = open ORDER BY id desc", { limit: 1 }).map((r) => r["id"]), ["4"]);
});

test("an empty query returns all rows; ORDER BY-only query sorts all", () => {
  assert.equal(runJql(rows, "").length, 4);
  assert.equal(runJql(rows, "   ").length, 4);
});

test("escaped quotes inside a string literal", () => {
  const r = [{ id: "1", name: "O'Brien" }];
  assert.deepEqual(runJql(r, "name = 'O''Brien'").map((x) => x["id"]), ["1"]);
});

// ── Safety / hardening ───────────────────────────────────────────────────────
test("syntax errors throw JqlError, never crash", () => {
  assert.throws(() => parseJql("status = "), JqlError);
  assert.throws(() => parseJql("status open"), JqlError);      // missing operator
  assert.throws(() => parseJql("(status = open"), JqlError);   // unbalanced paren
  assert.throws(() => parseJql("status = open EXTRA junk"), JqlError);
  assert.throws(() => parseJql("'unterminated"), JqlError);
});

test("a field named __proto__ is not tokenizable — no prototype reach", () => {
  assert.throws(() => parseJql("__proto__ = x"), JqlError); // leading underscore isn't a valid field start
});

test("over-long input and over-deep nesting are rejected (DoS bounds)", () => {
  assert.throws(() => parseJql("a = 1" + " OR a = 1".repeat(5000)), JqlError); // > MAX_INPUT
  assert.throws(() => parseJql("(".repeat(200) + "a = 1" + ")".repeat(200)), JqlError); // > MAX_DEPTH
});

test("~ takes no regex from input — a regex-y value is a literal substring, no ReDoS", () => {
  const r = [{ id: "1", title: "a+b" }, { id: "2", title: "aaaa" }];
  assert.deepEqual(runJql(r, "title ~ 'a+b'").map((x) => x["id"]), ["1"]); // literal 'a+b', not a pattern
});
