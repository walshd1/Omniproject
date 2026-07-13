import type { Request, Response } from "express";

/**
 * Server-Sent Events framing — ONE place that gets the SSE wire format right, shared by every SSE
 * endpoint (notifications, presence, the admin broker log). Before this, each route hand-wrote the
 * same headers, `ready` frame, `event:/data:` writer, keepalive ping and close cleanup; a drift in
 * one (a missing `no-transform`, an unguarded `res.write` after the socket closed) would only bite
 * that route. Centralising it keeps them consistent and each call site to its actual job.
 */

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // don't let nginx buffer the stream
} as const;

export interface SseStream {
  /** Emit a named event with a JSON payload. */
  send: (event: string, data: unknown) => void;
  /** Emit a comment line (`: text`) — used for keepalive pings. */
  comment: (text: string) => void;
  /** End the response (idempotent / safe if already gone). */
  close: () => void;
}

/** Begin an SSE response: write the stream headers + a `ready` frame, and return safe writers
 *  (every write is guarded, so a write after the client vanished is a no-op, not a throw). */
export function openSse(res: Response, ready: unknown = {}): SseStream {
  res.writeHead(200, SSE_HEADERS);
  const write = (chunk: string): void => {
    try { res.write(chunk); } catch { /* connection gone; the caller's close handler does cleanup */ }
  };
  write(`event: ready\ndata: ${JSON.stringify(ready)}\n\n`);
  return {
    send: (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    comment: (text) => write(`: ${text}\n\n`),
    close: () => { try { res.end(); } catch { /* already closed */ } },
  };
}

/** Keep the stream alive with a comment ping every `ms`, and run `onClose` (e.g. unsubscribe) when
 *  the request ends. Returns the interval handle so a caller can clear it earlier.
 *
 *  `onTick` is an optional per-tick guard: when it returns true (e.g. the streaming principal was
 *  just deprovisioned), the stream is closed mid-flight.
 *
 *  Cleanup (`clearInterval` + `onClose`) runs EXACTLY ONCE, whichever path fires first — the client
 *  disconnecting (`req`/`res` "close") OR the server self-closing on an `onTick`. The self-close path
 *  used to rely solely on `req.on("close")` to run `onClose`, but ending an SSE response over a
 *  keep-alive socket does not reliably emit that event — so the unsubscribe leaked and the ping timer
 *  hung. Calling the guarded cleanup directly from the `onTick` branch fixes that leak; the once-guard
 *  keeps the client-disconnect path from double-running it. */
export function keepAlive(stream: SseStream, req: Request, onClose: () => void, ms = 25_000, onTick?: () => boolean): ReturnType<typeof setInterval> {
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(ping);
    onClose();
  };
  const ping = setInterval(() => {
    if (onTick && onTick()) { stream.close(); cleanup(); return; }
    stream.comment("ping");
  }, ms);
  // Both events can fire for one disconnect; the once-guard makes that harmless. Listening to both
  // (not just req) also catches the case where only the response side observes the socket close.
  req.on("close", cleanup);
  req.res?.on("close", cleanup);
  return ping;
}
