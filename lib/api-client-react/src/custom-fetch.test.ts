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

/**
 * A minimal Response-like stand-in for runtimes that don't implement the whole
 * Response API — notably React Native, where `response.blob` is absent. Used to
 * drive the "blob() unavailable" fallbacks that a real Node Response can't reach.
 */
function fakeResponse(opts: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  text: string;
  /** Omit to simulate a runtime with no `blob()` method. */
  withBlob?: boolean;
}): Response {
  const status = opts.status ?? 200;
  const base: Record<string, unknown> = {
    ok: status >= 200 && status < 300,
    status,
    statusText: opts.statusText ?? "",
    url: "",
    headers: new Headers(opts.headers ?? {}),
    body: {}, // non-null: a payload is readable via text()
    text: async () => opts.text,
  };
  if (opts.withBlob) base["blob"] = async () => new Blob([opts.text]);
  return base as unknown as Response;
}

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

// --- interceptor sees the write body -------------------------------------
test("an interceptor receives the request method and JSON body of a write", async () => {
  stubFetch(() => json({}));
  let seen: { method: string; body: string | null } | null = null;
  setFetchInterceptor((req) => {
    seen = { method: req.method, body: req.body };
    return { handled: true, data: { ok: true } };
  });
  await customFetch("/api/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
  assert.deepEqual(seen, { method: "POST", body: '{"a":1}' });
  assert.equal(calls.length, 0);
});

// --- input shapes: URL object and Request object -------------------------
test("accepts a URL object as input and resolves it for the request", async () => {
  stubFetch(() => json({ ok: true }));
  const data = await customFetch<{ ok: boolean }>(new URL("https://api.example.com/api/z"));
  assert.deepEqual(data, { ok: true });
  assert.equal(String(calls[0]!.input), "https://api.example.com/api/z");
});

test("accepts a Request object, taking its method and forwarding its headers", async () => {
  stubFetch(() => json({ ok: true }));
  const req = new Request("https://api.example.com/req", {
    method: "POST",
    headers: { "x-req": "y" },
    body: JSON.stringify({ a: 1 }),
  });
  await customFetch(req);
  const sentHeaders = new Headers(calls[0]!.init!.headers);
  assert.equal(sentHeaders.get("x-req"), "y");
  assert.equal(calls[0]!.init!.method, "POST");
});

// --- explicit request headers are merged in ------------------------------
test("merges explicitly supplied request headers", async () => {
  stubFetch(() => json({}));
  await customFetch("/api/x", { headers: { "x-test": "1" } });
  const sentHeaders = new Headers(calls[0]!.init!.headers);
  assert.equal(sentHeaders.get("x-test"), "1");
});

// --- auth token getter resolving async / returning a string --------------
test("awaits an async auth token getter", async () => {
  stubFetch(() => json({}));
  setAuthTokenGetter(async () => "async-tok");
  await customFetch("/api/x");
  const sentHeaders = new Headers(calls[0]!.init!.headers);
  assert.equal(sentHeaders.get("authorization"), "Bearer async-tok");
});

test("an explicit Authorization header is not overwritten by the token getter", async () => {
  stubFetch(() => json({}));
  setAuthTokenGetter(() => "tok-123");
  await customFetch("/api/x", { headers: { authorization: "Bearer explicit" } });
  const sentHeaders = new Headers(calls[0]!.init!.headers);
  assert.equal(sentHeaders.get("authorization"), "Bearer explicit");
});

// --- success-body content-type inference ---------------------------------
test("auto-infers text for an application/xml body", async () => {
  stubFetch(() => new Response("<x/>", { status: 200, headers: { "Content-Type": "application/xml" } }));
  assert.equal(await customFetch("/api/xml"), "<x/>");
});

test("auto-infers blob for a binary content-type", async () => {
  stubFetch(() => new Response("BINDATA", { status: 200, headers: { "Content-Type": "application/octet-stream" } }));
  const data = await customFetch<Blob>("/api/bin");
  assert.ok(data instanceof Blob);
  assert.equal(await data.text(), "BINDATA");
});

test("responseType json returns null for a whitespace-only body", async () => {
  stubFetch(() => new Response("   ", { status: 200, headers: { "Content-Type": "application/json" } }));
  assert.equal(await customFetch("/api/x", { responseType: "json" }), null);
});

test("responseType blob throws a TypeError when blob() is unavailable", async () => {
  stubFetch(() => fakeResponse({ text: "payload", withBlob: false }));
  await assert.rejects(
    customFetch("/api/x", { responseType: "blob" }),
    (err: unknown) => {
      assert.ok(err instanceof TypeError);
      assert.match((err as TypeError).message, /Blob responses are not supported/);
      return true;
    },
  );
});

// --- error-body parsing branches -----------------------------------------
test("ApiError data is null when the error response has no body", async () => {
  stubFetch(() => new Response(null, { status: 500, statusText: "Server Error" }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.data, null);
    return true;
  });
});

test("ApiError data is null when the error body is whitespace only", async () => {
  stubFetch(() => new Response("   ", { status: 500, statusText: "Server Error", headers: { "Content-Type": "text/plain" } }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.data, null);
    return true;
  });
});

test("ApiError keeps the raw string when a JSON error body fails to parse", async () => {
  stubFetch(() => new Response("{oops", { status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/json" } }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.data, "{oops");
    return true;
  });
});

test("ApiError reads a binary error body as a Blob", async () => {
  stubFetch(() => new Response("BINERR", { status: 500, statusText: "Server Error", headers: { "Content-Type": "application/octet-stream" } }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.ok(err.data instanceof Blob);
    return true;
  });
});

test("ApiError falls back to text() for a binary error body when blob() is unavailable", async () => {
  stubFetch(() => fakeResponse({
    status: 500,
    statusText: "Server Error",
    headers: { "content-type": "application/octet-stream" },
    text: "BINERR",
    withBlob: false,
  }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.data, "BINERR");
    return true;
  });
});

// --- error message shaping variants --------------------------------------
test("ApiError message uses detail alone when there is no title", async () => {
  stubFetch(() => new Response(JSON.stringify({ detail: "just detail" }), {
    status: 400, statusText: "Bad Request", headers: { "Content-Type": "application/problem+json" },
  }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.match((err as ApiError).message, /HTTP 400 Bad Request: just detail/);
    return true;
  });
});

test("ApiError message uses message / error_description / error fields", async () => {
  stubFetch(() => new Response(JSON.stringify({ error: "e-code", error_description: "human readable" }), {
    status: 401, statusText: "Unauthorized", headers: { "Content-Type": "application/json" },
  }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    // error_description is preferred over error
    assert.match((err as ApiError).message, /HTTP 401 Unauthorized: human readable/);
    return true;
  });
});

test("ApiError message uses title alone when there is no detail or message", async () => {
  stubFetch(() => new Response(JSON.stringify({ title: "Only Title" }), {
    status: 409, statusText: "Conflict", headers: { "Content-Type": "application/problem+json" },
  }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.match((err as ApiError).message, /HTTP 409 Conflict: Only Title/);
    return true;
  });
});

test("ApiError message is just the status line for an unrecognised JSON error shape", async () => {
  stubFetch(() => new Response(JSON.stringify({ weird: "shape" }), {
    status: 418, statusText: "I'm a teapot", headers: { "Content-Type": "application/json" },
  }));
  await assert.rejects(customFetch("/api/x"), (err: unknown) => {
    assert.equal((err as ApiError).message, "HTTP 418 I'm a teapot");
    return true;
  });
});
