import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseTaskStatus, isActionable, isTaskClosed, TASK_STATUS_CLASS } from "./vocabulary";

test("normaliseTaskStatus folds tool dialects onto GTD states", () => {
  assert.equal(normaliseTaskStatus("Next Action"), "next");
  assert.equal(normaliseTaskStatus("To Do"), "next");
  assert.equal(normaliseTaskStatus("Waiting For"), "waiting");
  assert.equal(normaliseTaskStatus("blocked"), "waiting");
  assert.equal(normaliseTaskStatus("Calendar"), "scheduled");
  assert.equal(normaliseTaskStatus("Someday/Maybe"), "someday");
  assert.equal(normaliseTaskStatus("Completed"), "done");
  assert.equal(normaliseTaskStatus("Cancelled"), "dropped");
  assert.equal(normaliseTaskStatus("banana"), null);
});

test("isActionable: only 'next' is actionable now; waiting/deferred/done/dropped are not", () => {
  assert.equal(isActionable("next"), true);
  assert.equal(isActionable("waiting"), false);
  assert.equal(isActionable("scheduled"), false);
  assert.equal(isActionable("someday"), false);
  assert.equal(isActionable("done"), false);
  // Default-actionable: an uncategorised captured task is a candidate next-action.
  assert.equal(isActionable(undefined), true);
  assert.equal(isActionable("some-bespoke-state"), true);
});

test("isTaskClosed: done or dropped is terminal", () => {
  assert.equal(isTaskClosed("done"), true);
  assert.equal(isTaskClosed("dropped"), true);
  assert.equal(isTaskClosed("next"), false);
  assert.equal(isTaskClosed("waiting"), false);
  assert.equal(isTaskClosed(undefined), false);
});

test("every canonical task status maps to a workflow class", () => {
  for (const cls of Object.values(TASK_STATUS_CLASS)) {
    assert.ok(["actionable", "waiting", "deferred", "done", "dropped"].includes(cls));
  }
});
