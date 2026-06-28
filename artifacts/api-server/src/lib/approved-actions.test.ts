import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isActionApproved, approveAction, revokeApprovedAction, listApprovedActions,
  approveTerm, listApprovedVocab, setApproved, __resetApproved, DEFAULT_APPROVED_ACTIONS,
} from "./approved-actions";

/**
 * Customer-wide allowlist: reads approved by default, writes must be explicitly approved.
 */
afterEach(() => __resetApproved());

test("default-safe: read actions approved, write actions NOT", () => {
  assert.equal(isActionApproved("list_projects"), true);
  assert.equal(isActionApproved("get_portfolio_health"), true);
  assert.equal(isActionApproved("update_issue"), false);
  assert.equal(isActionApproved("delete_issue"), false);
  assert.deepEqual(listApprovedActions().sort(), [...DEFAULT_APPROVED_ACTIONS].sort());
});

test("the read-only portfolio copilot action is approved out of the box", () => {
  // Published as an AI action, but read-only, so it ships on the default allowlist.
  assert.equal(isActionApproved("portfolio_copilot"), true);
});

test("an admin can approve (and revoke) a write action", () => {
  approveAction("update_issue");
  assert.equal(isActionApproved("update_issue"), true);
  revokeApprovedAction("update_issue");
  assert.equal(isActionApproved("update_issue"), false);
});

test("vocabulary is curated (trimmed, deduped)", () => {
  approveTerm("Sprint");
  approveTerm("  Sprint  ");
  approveTerm("Epic");
  assert.deepEqual(listApprovedVocab().sort(), ["Epic", "Sprint"]);
});

test("setApproved replaces the whole file (apply a customer-wide allowlist)", () => {
  setApproved({ actions: ["list_projects"], vocab: ["Ticket"] });
  assert.deepEqual(listApprovedActions(), ["list_projects"]);
  assert.equal(isActionApproved("get_portfolio_health"), false); // no longer approved
  assert.deepEqual(listApprovedVocab(), ["Ticket"]);
});
