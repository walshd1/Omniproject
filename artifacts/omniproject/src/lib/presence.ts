import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Live-collaboration presence client (the "presence" feature module).
 *
 * Opens ONE SSE stream per shared "room" (e.g. a work item) to learn who else is here and which
 * field they're editing, and POSTs this tab's own editing claim back. Everything is ephemeral and
 * advisory: the field "lock" is a soft hint to avoid two people clobbering the same field, NOT a
 * gate — the hard guarantee stays the optimistic-concurrency token (a concurrent save still resolves
 * by 409 → refresh). Degrades to a no-op where EventSource is unavailable (SSR/tests) or disabled.
 */

export interface PresencePeer {
  cid: string;
  sub: string;
  label: string;
  color: string;
  editing: string | null;
  editingAt: number;
}

/** How long (ms) a peer's editing claim is shown before we treat it as stale locally. Mirrors the
 *  server's LOCK_TTL_MS — belt-and-braces so a "walked away" lock fades even between broadcasts. */
export const LOCK_TTL_MS = 15_000;
/** How often (ms) to refresh our own editing claim while a field stays focused. */
const HEARTBEAT_MS = 8_000;

/** A peer's initials for a compact avatar (first letters of up to two words, else first two chars). */
export function peerInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Peers with their editing claim expired against `now` (stale → not editing). Pure + tested. */
export function freshPeers(peers: PresencePeer[], now: number, ttl = LOCK_TTL_MS): PresencePeer[] {
  return peers.map((p) => (p.editing !== null && now - p.editingAt >= ttl ? { ...p, editing: null } : p));
}

/** Generate a per-tab connection id (stable for the hook's lifetime). */
function makeCid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `cid-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export interface UsePresenceResult {
  /** Other people in the room (this tab excluded), editing claims freshness-filtered. */
  peers: PresencePeer[];
  /** Claim (or release with null) the field this tab is editing — advisory, heartbeated. */
  setEditing: (field: string | null) => void;
}

/**
 * Join a presence room for as long as the component is mounted with a non-empty `roomId` and
 * `enabled`. Returns the other peers and a `setEditing` to advertise the focused field.
 */
export function usePresence(roomId: string | null, enabled: boolean): UsePresenceResult {
  const cidRef = useRef<string>("");
  if (!cidRef.current) cidRef.current = makeCid();
  const [raw, setRaw] = useState<PresencePeer[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());
  const editingRef = useRef<string | null>(null);

  const active = enabled && !!roomId && typeof EventSource !== "undefined";

  // The SSE stream: re-opened whenever the room (or enabled) changes.
  useEffect(() => {
    if (!active || !roomId) { setRaw([]); return; }
    const cid = cidRef.current;
    const url = `/api/presence/rooms/${encodeURIComponent(roomId)}/stream?cid=${encodeURIComponent(cid)}`;
    const es = new EventSource(url, { withCredentials: true });
    es.addEventListener("presence", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { peers?: PresencePeer[] };
        const others = (data.peers ?? []).filter((p) => p.cid !== cid);
        setRaw(others);
      } catch { /* ignore malformed frame */ }
    });
    return () => { es.close(); setRaw([]); };
  }, [active, roomId]);

  // Re-evaluate staleness on a slow tick so a "walked away" lock fades even with no new events.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [active]);

  const post = useCallback((field: string | null) => {
    if (!active || !roomId) return;
    void fetch(`/api/presence/rooms/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ cid: cidRef.current, editing: field }),
    }).catch(() => { /* presence is best-effort */ });
  }, [active, roomId]);

  const setEditing = useCallback((field: string | null) => {
    editingRef.current = field;
    post(field);
  }, [post]);

  // Heartbeat our own claim while a field stays focused, so the soft lock doesn't expire mid-edit.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (editingRef.current !== null) post(editingRef.current); }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [active, post]);

  return { peers: active ? freshPeers(raw, now) : [], setEditing };
}
