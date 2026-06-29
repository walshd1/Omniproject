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
 *  the request ends. Returns the interval handle so a caller can clear it earlier. */
export function keepAlive(stream: SseStream, req: Request, onClose: () => void, ms = 25_000): ReturnType<typeof setInterval> {
  const ping = setInterval(() => stream.comment("ping"), ms);
  req.on("close", () => { clearInterval(ping); onClose(); });
  return ping;
}
