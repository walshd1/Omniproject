import { test } from "node:test";
import assert from "node:assert/strict";
import { BINDING_ACTION_NAMES } from "./reference-broker-blueprint";
import { MCP_HANDLER_ACTIONS } from "../routes/mcp";
import { MCP_TOOLS } from "../lib/mcp";
import { DEFAULT_APPROVED_ACTIONS } from "../lib/approved-actions";

/**
 * Action-registry guards — the canonical action vocabularies (the binding-action
 * registry below the seam, and the MCP tool registry above it) replaced two hand
 * switches. These guards keep the registries from drifting out of sync with their
 * declarations, which a switch could silently do.
 */

test("the binding-action registry covers a stable, unique set of actions", () => {
  assert.equal(new Set(BINDING_ACTION_NAMES).size, BINDING_ACTION_NAMES.length, "binding actions must be unique");
  // The full binding surface (read + write) the broker core routes.
  assert.ok(BINDING_ACTION_NAMES.includes("list_projects"));
  assert.ok(BINDING_ACTION_NAMES.includes("create_issue"));
  assert.ok(BINDING_ACTION_NAMES.includes("delete_issue"));
});

test("every declared MCP tool has a handler, and every handler is a declared tool (no drift)", () => {
  const declared = new Set(MCP_TOOLS.map((t) => t.action));
  const handled = new Set(MCP_HANDLER_ACTIONS);
  const missingHandler = [...declared].filter((a) => !handled.has(a));
  const orphanHandler = [...handled].filter((a) => !declared.has(a));
  assert.deepEqual(missingHandler, [], "an MCP tool is declared with no executor — it would throw 'unsupported tool action'");
  assert.deepEqual(orphanHandler, [], "an MCP handler exists for an action no tool declares — dead code");
});

test("every read-only MCP tool is approved by default (reads-approved-out-of-the-box contract)", () => {
  // Guards the "reads are approved out of the box, writes are not" contract: a new READ tool
  // must be added to DEFAULT_APPROVED_ACTIONS, and no WRITE tool may sneak onto it.
  const approved = new Set(DEFAULT_APPROVED_ACTIONS);
  const readActions = [...new Set(MCP_TOOLS.filter((t) => !t.write).map((t) => t.action))];
  const writeActions = new Set(MCP_TOOLS.filter((t) => t.write).map((t) => t.action));
  const missing = readActions.filter((a) => !approved.has(a));
  const writesApproved = [...approved].filter((a) => writeActions.has(a));
  assert.deepEqual(missing, [], "a read-only MCP tool is not in DEFAULT_APPROVED_ACTIONS — it won't be approved out of the box");
  assert.deepEqual(writesApproved, [], "a WRITE action is on the default allowlist — writes must be admin-approved, never default");
});

test("the MCP action set overlaps but isn't a subset of the binding actions", () => {
  // Honest model: MCP exposes backend binding calls AND cross-plane catalogue
  // actions (list_reports/list_screens) that aren't backend binding actions.
  const binding = new Set(BINDING_ACTION_NAMES);
  assert.ok(MCP_HANDLER_ACTIONS.includes("list_reports"));
  assert.ok(!binding.has("list_reports"), "list_reports is a catalogue action, not a binding call");
  assert.ok(MCP_HANDLER_ACTIONS.some((a) => binding.has(a)), "MCP should reuse some binding actions");
});
