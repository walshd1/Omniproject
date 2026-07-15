import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, MCP_TOOLS, MCP_PROTOCOL_VERSION, toolByName, type McpExecutor, type McpPolicy } from "./mcp";

const echoExec: McpExecutor = async (tool, args) => ({ tool: tool.action, args });
const throwExec: McpExecutor = async () => { throw new Error("backend unreachable"); };
const WRITE_OK: McpPolicy = { writesEnabled: true, canWrite: true };

test("initialize returns the protocol version + tools capability", async () => {
  const r = await handleMcp({ id: 1, method: "initialize" }, echoExec, "9.9.9");
  assert.ok(r && "result" in r);
  const result = r.result as Record<string, unknown>;
  assert.equal(result["protocolVersion"], MCP_PROTOCOL_VERSION);
  assert.deepEqual(result["capabilities"], { tools: {} });
  assert.equal((result["serverInfo"] as Record<string, unknown>)["version"], "9.9.9");
});

test("tools/list hides write tools by default; shows them when writes are enabled", async () => {
  const ro = await handleMcp({ id: 2, method: "tools/list" }, echoExec, "0"); // default policy = read-only
  const roTools = (ro as { result: { tools: { name: string }[] } }).result.tools;
  assert.ok(roTools.some((t) => t.name === "omniproject_list_projects"));
  assert.ok(!roTools.some((t) => t.name === "omniproject_create_issue"), "write tools hidden when disabled");

  // Writes enabled AND every feature enabled ⇒ the full surface is advertised.
  const rw = await handleMcp({ id: 2, method: "tools/list" }, echoExec, "0", { ...WRITE_OK, featureEnabled: () => true });
  const rwTools = (rw as { result: { tools: { name: string; description: string }[] } }).result.tools;
  assert.equal(rwTools.length, MCP_TOOLS.length);
  const create = rwTools.find((t) => t.name === "omniproject_create_issue")!;
  assert.match(create.description, /HERE BE DRAGONS|WRITE/); // the loud warning is in the description
});

test("a feature-gated tool is hidden + refused when its feature is off, visible + callable when on", async () => {
  // Default policy has no featureEnabled ⇒ jqlSearch is OFF: search_issues is neither listed…
  const offList = await handleMcp({ id: 1, method: "tools/list" }, echoExec, "0");
  const offNames = (offList as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  assert.ok(!offNames.includes("omniproject_search_issues"), "feature-gated tool hidden when off");
  // …nor callable (refused as if it didn't exist, WITHOUT reaching exec).
  const offCall = await handleMcp({ id: 2, method: "tools/call", params: { name: "omniproject_search_issues", arguments: { jql: "status = open" } } }, throwExec, "0");
  assert.ok(offCall && "error" in offCall && (offCall.error as { code: number }).code === -32601);

  // Feature ON ⇒ listed and callable (exec runs).
  const on: McpPolicy = { writesEnabled: false, canWrite: false, featureEnabled: (f) => f === "jqlSearch" };
  const onList = await handleMcp({ id: 3, method: "tools/list" }, echoExec, "0", on);
  const onNames = (onList as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  assert.ok(onNames.includes("omniproject_search_issues"), "feature-gated tool visible when on");
  const onCall = await handleMcp({ id: 4, method: "tools/call", params: { name: "omniproject_search_issues", arguments: { jql: "status = open" } } }, echoExec, "0", on);
  assert.ok(onCall && "result" in onCall);
});

test("write tools are gated: disabled → -32004, enabled-but-no-privilege → -32004, allowed → runs", async () => {
  const call = { id: 9, method: "tools/call", params: { name: "omniproject_create_issue", arguments: { projectId: "p1", title: "x" } } };
  // Default (writes disabled):
  const off = await handleMcp(call, echoExec, "0");
  assert.ok(off && "error" in off && off.error.code === -32004);
  assert.match((off as { error: { message: string } }).error.message, /disabled/i);
  // Enabled but caller can't write (e.g. a read-only token):
  const noPriv = await handleMcp(call, echoExec, "0", { writesEnabled: true, canWrite: false });
  assert.ok(noPriv && "error" in noPriv && noPriv.error.code === -32004);
  assert.match((noPriv as { error: { message: string } }).error.message, /contributor/i);
  // Fully allowed:
  const okCall = await handleMcp(call, echoExec, "0", WRITE_OK);
  assert.ok(okCall && "result" in okCall);
  assert.equal(JSON.parse((okCall as { result: { content: { text: string }[] } }).result.content[0]!.text).tool, "create_issue");
});

test("tools/call runs the executor and returns a text content block", async () => {
  const r = await handleMcp({ id: 3, method: "tools/call", params: { name: "omniproject_list_projects", arguments: {} } }, echoExec, "0");
  const result = (r as { result: { content: { type: string; text: string }[] } }).result;
  assert.equal(result.content[0]!.type, "text");
  assert.equal(JSON.parse(result.content[0]!.text).tool, "list_projects");
});

test("tools/call enforces required arguments", async () => {
  const r = await handleMcp({ id: 4, method: "tools/call", params: { name: "omniproject_list_issues", arguments: {} } }, echoExec, "0");
  assert.ok(r && "error" in r);
  assert.equal(r.error.code, -32602);
  assert.match(r.error.message, /projectId/);
});

test("an unknown tool is a JSON-RPC error", async () => {
  const r = await handleMcp({ id: 5, method: "tools/call", params: { name: "omniproject_delete_everything", arguments: {} } }, echoExec, "0");
  assert.ok(r && "error" in r && r.error.code === -32602);
});

test("a tool that throws is returned as an isError result (model-visible, no leak)", async () => {
  const r = await handleMcp({ id: 6, method: "tools/call", params: { name: "omniproject_list_projects", arguments: {} } }, throwExec, "0");
  const result = (r as { result: { content: { text: string }[]; isError: boolean } }).result;
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text, /backend unreachable/);
});

test("notifications (no id) get no response; unknown methods do", async () => {
  assert.equal(await handleMcp({ method: "notifications/initialized" }, echoExec, "0"), null);
  const r = await handleMcp({ id: 7, method: "no/such/method" }, echoExec, "0");
  assert.ok(r && "error" in r && r.error.code === -32601);
});

test("ping responds empty; toolByName resolves", async () => {
  const r = await handleMcp({ id: 8, method: "ping" }, echoExec, "0");
  assert.deepEqual((r as { result: unknown }).result, {});
  assert.equal(toolByName("omniproject_capabilities")?.action, "get_capabilities");
});
