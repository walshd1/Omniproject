import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Whiteboard LIVE CURSORS (roadmap 2.3). Multi-user cursor presence on a board over the SSE relay
 * (`/api/whiteboards/rooms/:roomId`), keyed by the `board:<id>` room. Purely transient — like presence,
 * nothing is stored; the durable scene still saves through the storage target. Each tab broadcasts its
 * pointer position (throttled); inbound peers' cursors are collected with a short TTL so a "left" cursor
 * fades even without an explicit leave. Degrades to a no-op where `EventSource` is unavailable (SSR/tests)
 * or the feature is off. Identity (label + colour) is stamped SERVER-side, so a peer can't spoof a name.
 */

export interface RemoteCursor { cid: string; label: string; color: string; x: number; y: number; at: number }

/** Drop a peer's cursor this long after its last update (ms) — covers a silent leave / frozen tab. */
const CURSOR_TTL_MS = 5_000;
/** Minimum gap between our own position broadcasts (ms) — throttle a fast drag to a sane rate. */
const PUBLISH_INTERVAL_MS = 60;

/** A per-tab connection id (stable for the hook's lifetime). */
function makeCid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `cid-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export interface LiveCursors {
  /** Other tabs' cursors (this tab excluded), stale ones expired. */
  cursors: RemoteCursor[];
  /** Broadcast this tab's pointer position (SVG coords); throttled + best-effort. */
  publish: (x: number, y: number) => void;
  /** True when the transport is actually active. */
  live: boolean;
}

export function useLiveCursors(roomId: string | null, enabled: boolean): LiveCursors {
  const live = enabled && !!roomId && typeof EventSource !== "undefined";
  const cidRef = useRef<string>("");
  if (!cidRef.current) cidRef.current = makeCid();
  const [cursors, setCursors] = useState<RemoteCursor[]>([]);

  // The SSE stream: re-opened whenever the room (or live) changes.
  useEffect(() => {
    if (!live || !roomId) { setCursors([]); return; }
    const cid = cidRef.current;
    const es = new EventSource(
      `/api/whiteboards/rooms/${encodeURIComponent(roomId)}/stream?cid=${encodeURIComponent(cid)}`,
      { withCredentials: true },
    );
    es.addEventListener("cursor", (ev) => {
      try {
        const { from, label, color, msg } = JSON.parse((ev as MessageEvent).data) as
          { from: string; label?: string; color?: string; msg?: { x?: unknown; y?: unknown } };
        if (from === cid || !msg || typeof msg.x !== "number" || typeof msg.y !== "number") return;
        setCursors((cur) => [
          ...cur.filter((c) => c.cid !== from),
          { cid: from, label: String(label ?? "Someone"), color: String(color ?? "#888"), x: msg.x as number, y: msg.y as number, at: Date.now() },
        ]);
      } catch { /* ignore a malformed frame */ }
    });
    return () => { es.close(); setCursors([]); };
  }, [live, roomId]);

  // Expire stale cursors on a slow tick, so a peer who left (or froze) fades without an explicit leave.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setCursors((cur) => {
      const now = Date.now();
      const fresh = cur.filter((c) => now - c.at < CURSOR_TTL_MS);
      return fresh.length === cur.length ? cur : fresh;
    }), 1_000);
    return () => clearInterval(t);
  }, [live]);

  const lastSent = useRef(0);
  const publish = useCallback((x: number, y: number) => {
    if (!live || !roomId) return;
    const now = Date.now();
    if (now - lastSent.current < PUBLISH_INTERVAL_MS) return;
    lastSent.current = now;
    void fetch(`/api/whiteboards/rooms/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ cid: cidRef.current, msg: { x: Math.round(x), y: Math.round(y) } }),
    }).catch(() => { /* cursor broadcast is best-effort */ });
  }, [live, roomId]);

  return { cursors: live ? cursors : [], publish, live };
}
