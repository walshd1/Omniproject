import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, MCP_TOOLS, MCP_PROTOCOL_VERSION, toolByName, type McpExecutor } from "./mcp";

const echoExec: McpExecutor = async (tool, args) => ({ tool: tool.action, args });
const throwExec: McpExecutor = async () => { throw new Error("backend unreachable"); };

test("initialize returns the protocol version + tools capability", async () => {
  const r = await handleMcp({ id: 1, method: "initialize" }, echoExec, "9.9.9");
  assert.ok(r && "result" in r);
  const result = r.result as Record<string, unknown>;
  assert.equal(result["protocolVersion"], MCP_PROTOCOL_VERSION);
  assert.deepEqual(result["capabilities"], { tools: {} });
  assert.equal((result["serverInfo"] as Record<string, unknown>)["version"], "9.9.9");
});

test("tools/list advertises the read-only tool surface with input schemas", async () => {
  const r = await handleMcp({ id: 2, method: "tools/list" }, echoExec, "0");
  const tools = (r as { result: { tools: { name: string; inputSchema: unknown }[] } }).result.tools;
  assert.equal(tools.length, MCP_TOOLS.length);
  assert.ok(tools.some((t) => t.name === "omniproject_list_projects"));
  const li = tools.find((t) => t.name === "omniproject_list_issues")!;
  assert.deepEqual((li.inputSchema as { required: string[] }).required, ["projectId"]);
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
