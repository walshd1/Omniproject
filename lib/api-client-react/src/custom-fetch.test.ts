import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  customFetch,
  setBaseUrl,
  setAuthTokenGetter,
  setFetchInterceptor,
  ApiError,
  ResponseParseError,
} from "./custom-fetch";

/**
 * The hand-written fetch wrapper is the one piece of api-client-react that is NOT generated —
 * it carries the base-URL, bearer-token and interceptor seams plus all the response parsing /
 * error shaping. These tests exercise those branches directly (the generated hooks just call it).
 */

type FetchArgs = { input: RequestInfo | URL; init: RequestInit | undefined };
let calls: FetchArgs[] = [];
const realFetch = globalThis.fetch;

/** Install a fake fetch that returns the given Response (or runs a per-call factory). */
function stubFetch(factory: (args: FetchArgs) => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const args = { input, init };
    calls.push(args);
    return factory(args);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

beforeEach(() => {
  calls = [];
  setBaseUrl(null);
  setAuthTokenGetter(null);
  setFetchInterceptor(null);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setBaseUrl(null);
  setAuthTokenGetter(null);
  setFetchInterceptor(null);
});

test("parses a JSON success body (auto by content-type)", async () => {
  stubFetch(() => json({ ok: true, n: 2 }));
  const data = await customFetch<{ ok: boolean; n: number }>("/api/x");
  assert.deepEqual(data, { ok: true, n: 2 });
});

test("returns the raw string for a text/plain body", async () => {
  stubFetch(() => new Response("hello", { status: 200, headers: { "Content-Type": "text/plain" } }));
  assert.equal(await customFetch("/api/text"), "hello");
});

test("returns null for a 204 no-body response", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  assert.equal(await customFetch("/api/empty"), null);
});

test("auto-infers text when there is no content-type", async () => {
  stubFetch(() => new Response("plain", { status: 200 }));
  assert.equal(await customFetch("/api/notype"), "plain");
});

test("throws ApiError with a problem+json title/detail message", async () => {
  stubFetch(() => new Response(JSON.stringify({ title: "Nope", detail: "bad input" }), {
    status: 422, statusText: "Unprocessable", headers: { "Content-Type": "application/problem+json" },
  }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 422);
    assert.match(err.message, /Nope — bad input/);
    assert.deepEqual(err.data, { title: "Nope", detail: "bad input" });
    return true;
  });
});

test("ApiError surfaces a plain-text error body", async () => {
  stubFetch(() => new Response("boom", { status: 500, statusText: "Server Error", headers: { "Content-Type": "text/plain" } }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 500);
    assert.match(err.message, /boom/);
    return true;
  });
});

test("throws ResponseParseError on invalid JSON with a JSON content-type", async () => {
  stubFetch(() => new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(customFetch("/api/x", { responseType: "json" }), (err: unknown) => {
    assert.ok(err instanceof ResponseParseError);
    assert.equal(err.rawBody, "{not json");
    return true;
  });
});

test("rejects a GET/HEAD request that carries a body", async () => {
  stubFetch(() => json({}));
  await assert.rejects(customFetch("/api/x", { method: "GET", body: "{}" }), /cannot have a body/);
  assert.equal(calls.length, 0, "must not reach the network");
});

test("auto-sets a JSON content-type for a JSON-looking string body", async () => {
  stubFetch(() => json({ ok: true }));
  await customFetch("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
  const headers = new Headers(calls[0]!.init!.headers);
  assert.equal(headers.get("content-type"), "application/json");
});

test("sets an Accept header when responseType is json", async () => {
  stubFetch(() => json({}));
  await customFetch("/api/x", { responseType: "json" });
  const headers = new Headers(calls[0]!.init!.headers);
  assert.match(headers.get("accept") ?? "", /application\/json/);
});

test("setBaseUrl prepends to relative paths but not absolute URLs", async () => {
  stubFetch(() => json({}));
  setBaseUrl("https://api.example.com/");
  await customFetch("/api/x");
  assert.equal(String(calls[0]!.input), "https://api.example.com/api/x");

  calls = [];
  await customFetch("https://other.example/y");
  assert.equal(String(calls[0]!.input), "https://other.example/y");
});

test("setAuthTokenGetter attaches a bearer token when present", async () => {
  stubFetch(() => json({}));
  setAuthTokenGetter(() => "tok-123");
  await customFetch("/api/x");
  const headers = new Headers(calls[0]!.init!.headers);
  assert.equal(headers.get("authorization"), "Bearer tok-123");
});

test("a null token getter adds no Authorization header", async () => {
  stubFetch(() => json({}));
  setAuthTokenGetter(() => null);
  await customFetch("/api/x");
  const headers = new Headers(calls[0]!.init!.headers);
  assert.equal(headers.get("authorization"), null);
});

test("an installed interceptor can answer without hitting the network", async () => {
  stubFetch(() => json({ fromNetwork: true }));
  setFetchInterceptor((req) => ({ handled: true, data: { echoed: req.url } }));
  const data = await customFetch<{ echoed: string }>("/api/x");
  assert.deepEqual(data, { echoed: "/api/x" });
  assert.equal(calls.length, 0, "interceptor short-circuits the network");
});

test("an interceptor returning handled:false falls through to fetch", async () => {
  stubFetch(() => json({ fromNetwork: true }));
  setFetchInterceptor(() => ({ handled: false }));
  const data = await customFetch<{ fromNetwork: boolean }>("/api/x");
  assert.deepEqual(data, { fromNetwork: true });
  assert.equal(calls.length, 1);
});
