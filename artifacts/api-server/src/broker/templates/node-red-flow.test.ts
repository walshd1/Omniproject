import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Guards the importable Node-RED flow: it must be valid Node-RED JSON wired
 * webhook → binding → response, and its `binding` function must answer the verify
 * handshake + capabilities synchronously (the part that proves the seam with no
 * backend). Keeps the "truly testable with Node-RED" template from rotting.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const flow = JSON.parse(readFileSync(path.join(HERE, "node-red-flow.json"), "utf8")) as Array<Record<string, unknown>>;

function nodeOfType(type: string): Record<string, unknown> {
  const n = flow.find((x) => x["type"] === type);
  assert.ok(n, `flow should contain a "${type}" node`);
  return n!;
}

/** Run the function node's body the way Node-RED would (msg in, msg out). */
function runBinding(payload: unknown): { statusCode: number; payload: { success: boolean; data?: unknown; message?: string } } {
  const fn = nodeOfType("function");
  const body = String(fn["func"]);
  const msg: Record<string, unknown> = { payload };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const out = new Function("msg", body)(msg) as typeof msg;
  return { statusCode: out["statusCode"] as number, payload: out["payload"] as { success: boolean; data?: unknown; message?: string } };
}

test("the flow is a valid Node-RED graph: http in → function → http response", () => {
  const httpIn = nodeOfType("http in");
  const fn = nodeOfType("function");
  nodeOfType("http response");
  assert.equal(httpIn["method"], "post");
  assert.equal(httpIn["url"], "/omniproject");
  // http in wires to the function, function wires onward (to the response).
  assert.deepEqual(httpIn["wires"], [[fn["id"]]]);
  assert.ok(Array.isArray(fn["wires"]) && (fn["wires"] as unknown[][])[0]!.length === 1);
});

test("the binding answers the verify handshake synchronously, no backend", () => {
  const res = runBinding({ verify: true });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { success: true, data: { verified: true } });
});

test("the binding answers get_capabilities with the contract envelope", () => {
  const res = runBinding({ action: "get_capabilities" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.success, true);
  assert.equal((res.payload.data as Record<string, boolean>)["issues"], true);
});

test("an unwired data action fails honestly (501 success:false), never a silent empty OK", () => {
  const res = runBinding({ action: "list_projects" });
  assert.equal(res.statusCode, 501);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.message ?? "", /not wired/);
});
