import { useEffect, useRef } from "react";

/**
 * Shared live-event stream — ONE EventSource to the notification SSE that every
 * subscriber shares, instead of each component opening its own. It is the primitive
 * behind live, push-based panel revalidation: a panel subscribes, and when an event
 * for its resource arrives it revalidates ONLY itself (conditionally, so an
 * unchanged refetch is a cheap 304). No polling.
 *
 * The connection is lazy (opens on the first subscriber, closes when the last
 * leaves) and degrades to a no-op where EventSource is unavailable (SSR/tests).
 */

export interface LiveEvent {
  kind?: string;
  [k: string]: unknown;
}
type Handler = (event: LiveEvent) => void;

let source: EventSource | null = null;
const handlers = new Set<Handler>();

function ensureConnected(): void {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/notifications/stream", { withCredentials: true });
  source.addEventListener("notification", (ev) => {
    let data: LiveEvent = {};
    try { data = JSON.parse((ev as MessageEvent).data) as LiveEvent; } catch { /* ignore malformed */ }
    for (const h of [...handlers]) h(data);
  });
}

function maybeDisconnect(): void {
  if (handlers.size === 0 && source) {
    source.close();
    source = null;
  }
}

/** Subscribe to live notification events; returns an unsubscribe fn. */
export function subscribeLiveEvents(handler: Handler): () => void {
  handlers.add(handler);
  ensureConnected();
  return () => {
    handlers.delete(handler);
    maybeDisconnect();
  };
}

/** React hook form — subscribe for the component's lifetime (latest handler used). */
export function useLiveEvents(handler: Handler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeLiveEvents((e) => ref.current(e)), []);
}

/**
 * Does a live event warrant revalidating a panel? `liveOn` is the kinds the panel
 * cares about; undefined/empty ⇒ any change revalidates it (broad, but still only
 * a conditional refetch). Used to keep a panel reacting to ITS resource only.
 */
export function matchesLive(event: LiveEvent, liveOn?: string[]): boolean {
  if (!liveOn || liveOn.length === 0) return true;
  return typeof event.kind === "string" && liveOn.includes(event.kind);
}
