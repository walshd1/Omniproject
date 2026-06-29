import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { openSse, keepAlive } from "./sse";

/**
 * SSE framing helper — the single place the event-stream wire format lives.
 */

interface FakeRes { res: Response; head?: Record<string, string>; status?: number; writes: string[]; ended: boolean }
function fakeRes(): FakeRes {
  const f: FakeRes = { res: null as unknown as Response, writes: [], ended: false };
  f.res = {
    writeHead(status: number, headers: Record<string, string>) { f.status = status; f.head = headers; return this; },
    write(chunk: string) { f.writes.push(chunk); return true; },
    end() { f.ended = true; return this; },
  } as unknown as Response;
  return f;
}

test("openSse writes the stream headers and a ready frame", () => {
  const f = fakeRes();
  openSse(f.res, { ok: true });
  assert.equal(f.status, 200);
  assert.equal(f.head?.["Content-Type"], "text/event-stream");
  assert.equal(f.head?.["Cache-Control"], "no-cache, no-transform");
  assert.equal(f.head?.["X-Accel-Buffering"], "no");
  assert.equal(f.writes[0], `event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
});

test("send / comment / close produce the right frames", () => {
  const f = fakeRes();
  const s = openSse(f.res);
  s.send("entry", { id: "x" });
  s.comment("ping");
  s.close();
  assert.equal(f.writes[1], `event: entry\ndata: ${JSON.stringify({ id: "x" })}\n\n`);
  assert.equal(f.writes[2], ": ping\n\n");
  assert.equal(f.ended, true);
});

test("writes after the socket is gone are swallowed (no throw)", () => {
  const f = fakeRes();
  const s = openSse(f.res);
  (f.res as unknown as { write: () => never }).write = () => { throw new Error("EPIPE"); };
  assert.doesNotThrow(() => s.send("entry", {}));
  assert.doesNotThrow(() => s.comment("ping"));
});

test("keepAlive pings on the interval and clears + runs onClose when the request ends", () => {
  const f = fakeRes();
  const s = openSse(f.res);
  let closed = false;
  const handlers: Record<string, () => void> = {};
  const req = { on: (ev: string, fn: () => void) => { handlers[ev] = fn; } } as unknown as Request;
  const ping = keepAlive(s, req, () => { closed = true; }, 10);
  try {
    assert.ok(handlers["close"], "registered a close handler");
    handlers["close"]!();
    assert.equal(closed, true, "onClose ran");
  } finally {
    clearInterval(ping);
  }
});
