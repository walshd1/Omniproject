import { describe, it, expect, vi, afterEach } from "vitest";
import { planNlAction, executePlannedAction, type ActionPlan } from "./nl-action";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("planNlAction", () => {
  it("POSTs the instruction and returns the plan (no surface)", async () => {
    const plan: ActionPlan = { kind: "action", tool: "issues", action: "create", args: { title: "x" }, write: true };
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ plan }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(planNlAction("make an issue")).resolves.toEqual(plan);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({ text: "make an issue" }); // no surface key when omitted
  });

  it("includes the surface when provided", async () => {
    const plan: ActionPlan = { kind: "clarify", question: "which project?" };
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ plan }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(planNlAction("do it", "/projects/p1")).resolves.toEqual(plan);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.surface).toBe("/projects/p1");
  });

  it("throws the server error on a non-ok plan", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ error: "bad prompt" }), { status: 400, headers: { "Content-Type": "application/json" } })));
    await expect(planNlAction("x")).rejects.toThrow("bad prompt");
  });

  it("falls back to a status message when the error body is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response("boom", { status: 502 })));
    await expect(planNlAction("x")).rejects.toThrow("Planning failed (502)");
  });
});

describe("executePlannedAction", () => {
  it("returns the MCP result on success", async () => {
    const result = { content: [{ text: "done" }], isError: false };
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ result }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(executePlannedAction("issues", { title: "x" })).resolves.toEqual(result);
  });

  it("sends a well-formed JSON-RPC tools/call body", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await executePlannedAction("issues.update", { id: "1" });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name: "issues.update", arguments: { id: "1" } } });
  });

  it("throws the JSON-RPC error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ error: { message: "no such tool" } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(executePlannedAction("nope", {})).rejects.toThrow("no such tool");
  });

  it("throws a generic message when the error carries no message", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ error: {} }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(executePlannedAction("nope", {})).rejects.toThrow("Action failed");
  });

  it("throws the tool's own error text when the result is flagged isError", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ result: { isError: true, content: [{ text: "policy blocked" }] } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(executePlannedAction("issues", {})).rejects.toThrow("policy blocked");
  });

  it("throws a fallback when an isError result carries no content text", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ result: { isError: true } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(executePlannedAction("issues", {})).rejects.toThrow("Action returned an error");
  });

  it("treats an unparseable body as an empty object (no error, undefined result)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response("<html>not json", { status: 200 })));
    await expect(executePlannedAction("issues", {})).resolves.toBeUndefined();
  });
});
