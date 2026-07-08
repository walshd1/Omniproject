import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * In-process HTTP coverage for the MCP JSON-RPC edge (POST /api/mcp, routes/mcp.ts).
 *
 * MCP is mounted OUTSIDE requireAuth (it accepts a read-only API token as well as a session),
 * so its own auth + the governance gate (the `mcp` capability is OFF by default) are exercised
 * here directly. With the capability turned on the JSON-RPC surface (initialize / ping /
 * tools.list / tools.call) runs against the demo broker, so the read tools return real data and
 * the executor's approve-list + audit branches are covered end to end.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

async function enableMcp(): Promise<void> {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ capabilityStates: { mcp: { state: "public" } } });
}
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ capabilityStates: {} });
  delete process.env["MCP_WRITE_ENABLED"];
  const { __resetApproved } = await import("../lib/approved-actions");
  __resetApproved();
});

const rpc = (body: unknown, cookie?: string) =>
  h.req("/mcp", { method: "POST", ...(cookie ? { cookie } : {}), body });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("no session and no API token → 401 JSON-RPC error", async () => {
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(r.status, 401);
  const b = await json(r);
  assert.equal(b.error.code, -32001);
  assert.equal(b.id, 1);
});

test("MCP capability off by default → 403 with the -32004 refusal", async () => {
  const r = await rpc({ jsonrpc: "2.0", id: 2, method: "initialize" }, adminCookie());
  assert.equal(r.status, 403);
  const b = await json(r);
  assert.equal(b.error.code, -32004);
  assert.match(b.error.message, /turned off/i);
});

test("initialize / ping / tools.list once the capability is enabled", async () => {
  await enableMcp();

  const init = await json(await rpc({ jsonrpc: "2.0", id: "i", method: "initialize" }, adminCookie()));
  assert.equal(init.result.serverInfo.name, "omniproject");
  assert.equal(init.result.protocolVersion, "2024-11-05");

  const ping = await json(await rpc({ jsonrpc: "2.0", id: "p", method: "ping" }, adminCookie()));
  assert.deepEqual(ping.result, {});

  const list = await json(await rpc({ jsonrpc: "2.0", id: "l", method: "tools/list" }, adminCookie()));
  const names = list.result.tools.map((t: { name: string }) => t.name);
  assert.ok(names.includes("omniproject_list_projects"));
  // Writes are disabled (no MCP_WRITE_ENABLED) so write tools are NOT advertised.
  assert.equal(names.includes("omniproject_create_issue"), false);
});

test("a JSON-RPC notification (no id) → 202 with no body", async () => {
  await enableMcp();
  const r = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, adminCookie());
  assert.equal(r.status, 202);
  assert.equal(await r.text(), "");
});

test("unknown method → -32601 method-not-found", async () => {
  await enableMcp();
  const b = await json(await rpc({ jsonrpc: "2.0", id: 9, method: "does/not/exist" }, adminCookie()));
  assert.equal(b.error.code, -32601);
});

test("tools/call list_projects executes against the demo broker + audits", async () => {
  await enableMcp();
  const b = await json(await rpc(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "omniproject_list_projects", arguments: {} } },
    adminCookie(),
  ));
  assert.equal(b.error, undefined);
  assert.equal(b.result.isError, undefined);
  const text = b.result.content[0].text;
  const projects = JSON.parse(text);
  assert.ok(Array.isArray(projects) || typeof projects === "object");
});

test("tools/call list_reports + list_screens (cross-plane catalogue handlers)", async () => {
  await enableMcp();
  for (const name of ["omniproject_list_reports", "omniproject_list_screens"]) {
    const b = await json(await rpc(
      { jsonrpc: "2.0", id: name, method: "tools/call", params: { name, arguments: {} } },
      adminCookie(),
    ));
    assert.equal(b.result.isError, undefined, `${name} should succeed`);
    assert.ok(Array.isArray(JSON.parse(b.result.content[0].text)));
  }
});

test("tools/call portfolio_copilot runs the handler (AI provider 'none' surfaces as an isError result)", async () => {
  await enableMcp();
  const b = await json(await rpc(
    { jsonrpc: "2.0", id: "c", method: "tools/call", params: { name: "omniproject_portfolio_copilot", arguments: { question: "how are we doing?" } } },
    adminCookie(),
  ));
  // The handler executed; with no AI provider configured aiChat throws and handleMcp maps it to
  // an isError tool result (never a protocol error) so the model sees the failure.
  assert.equal(b.result.isError, true);
  assert.match(b.result.content[0].text, /Error:/);
});

test("tools/call unknown tool → -32602 invalid params", async () => {
  await enableMcp();
  const b = await json(await rpc(
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    adminCookie(),
  ));
  assert.equal(b.error.code, -32602);
  assert.match(b.error.message, /unknown tool/);
});

test("tools/call with a missing required argument → -32602", async () => {
  await enableMcp();
  const b = await json(await rpc(
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "omniproject_list_issues", arguments: {} } },
    adminCookie(),
  ));
  assert.equal(b.error.code, -32602);
  assert.match(b.error.message, /missing required argument: projectId/);
});

test("a write tool is refused while writes are disabled → -32004", async () => {
  await enableMcp();
  const b = await json(await rpc(
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "omniproject_create_issue", arguments: { projectId: "p1", title: "x" } } },
    adminCookie(),
  ));
  assert.equal(b.error.code, -32004);
  assert.match(b.error.message, /writes are disabled/i);
});

test("with MCP_WRITE_ENABLED + an approved write action, a contributor+ session may write", async () => {
  await enableMcp();
  process.env["MCP_WRITE_ENABLED"] = "true";
  const { approveAction } = await import("../lib/approved-actions");
  approveAction("create_issue"); // writes are NOT approved by default

  // tools/list now advertises the write tools (writesEnabled branch of visibleTools).
  const list = await json(await rpc({ jsonrpc: "2.0", id: "wl", method: "tools/list" }, adminCookie()));
  assert.ok(list.result.tools.map((t: { name: string }) => t.name).includes("omniproject_create_issue"));

  // A real project id from the demo broker, so the write dispatches through the executor.
  const projects = JSON.parse((await json(await rpc(
    { jsonrpc: "2.0", id: "lp", method: "tools/call", params: { name: "omniproject_list_projects", arguments: {} } },
    adminCookie(),
  ))).result.content[0].text);
  const projectId = Array.isArray(projects) ? projects[0]?.id : undefined;
  assert.ok(projectId, "expected a demo project id");

  const b = await json(await rpc(
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "omniproject_create_issue", arguments: { projectId, title: "from mcp test" } } },
    adminCookie(),
  ));
  // The write policy allowed it (no -32004 protocol refusal); the executor ran on the demo broker.
  assert.equal(b.error, undefined);
  assert.ok(b.result);
  assert.equal(b.result.isError, undefined, `write should have succeeded: ${b.result?.content?.[0]?.text}`);
});
