import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import type { DocBlock } from "@workspace/backend-catalogue";
import { readBlocks, writeBlocks, seedUpdateFromBlocks, toBase64, fromBase64 } from "./collab-doc";

/**
 * Real-time collaborative block editing (roadmap 2.1 slice 6 — Yjs co-edit). A drop-in for the editor's
 * `[blocks, setBlocks]`: when co-edit is enabled for a room, the blocks are backed by a shared Yjs document
 * synced over the SSE relay, so two people editing the same page see each other's changes merge live; when
 * disabled (or where `EventSource` is unavailable, e.g. tests/SSR), it degrades to plain local state and the
 * editor behaves exactly as before.
 *
 * The transport is our dumb relay: each local CRDT update is POSTed to `/api/collab/rooms/:roomId` and fanned
 * out to peers; inbound updates arrive on the SSE stream. On join we broadcast our state vector so peers send
 * what we're missing (a tiny sync handshake using only `yjs` core — no y-protocols). The durable document is
 * still saved through the broker seam on "Save"; this shared state is transient, like presence.
 */

/** A per-tab connection id (stable for the hook's lifetime). */
function makeCid(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `cid-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

type CollabMsg = { t: "update"; u: string } | { t: "sync"; sv: string };

export interface CollabBlocks {
  blocks: DocBlock[];
  /** Replace the block list (full array); reconciled into the shared doc and broadcast when live. */
  setBlocks: (next: DocBlock[]) => void;
  /** True when the co-edit transport is actually active (feature on, room set, EventSource available). */
  live: boolean;
}

export function useCollabBlocks(roomId: string | null, initial: DocBlock[], enabled: boolean): CollabBlocks {
  const live = enabled && !!roomId && typeof EventSource !== "undefined";
  const [blocks, setLocal] = useState<DocBlock[]>(initial);
  const docRef = useRef<Y.Doc | null>(null);
  const cidRef = useRef<string>("");
  if (!cidRef.current) cidRef.current = makeCid();
  // Latest persisted blocks for seeding, without making the effect depend on array identity.
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!live || !roomId) return;
    const doc = new Y.Doc();
    docRef.current = doc;
    const cid = cidRef.current;
    // Deterministic seed from the persisted blocks (idempotent across clients — no duplicate blocks).
    Y.applyUpdate(doc, seedUpdateFromBlocks(initialRef.current), "seed");
    setLocal(readBlocks(doc));

    const relay = (msg: CollabMsg): void => {
      void fetch(`/api/collab/rooms/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ cid, msg }),
      }).catch(() => { /* relay is best-effort */ });
    };

    const onUpdate = (u: Uint8Array, origin: unknown): void => {
      setLocal(readBlocks(doc));
      if (origin !== "remote") relay({ t: "update", u: toBase64(u) });
    };
    doc.on("update", onUpdate);

    const es = new EventSource(
      `/api/collab/rooms/${encodeURIComponent(roomId)}/stream?cid=${encodeURIComponent(cid)}`,
      { withCredentials: true },
    );
    // On join, ask peers for anything we don't have yet (send our state vector).
    es.addEventListener("ready", () => relay({ t: "sync", sv: toBase64(Y.encodeStateVector(doc)) }));
    es.addEventListener("collab", (ev) => {
      try {
        const { from, msg } = JSON.parse((ev as MessageEvent).data) as { from: string; msg: CollabMsg };
        if (from === cid) return; // ignore our own echo
        if (msg.t === "update") {
          const u = fromBase64(msg.u);
          if (u) Y.applyUpdate(doc, u, "remote");
        } else if (msg.t === "sync") {
          const sv = fromBase64(msg.sv);
          relay({ t: "update", u: toBase64(Y.encodeStateAsUpdate(doc, sv ?? undefined)) });
        }
      } catch { /* ignore malformed frame */ }
    });

    return () => {
      doc.off("update", onUpdate);
      es.close();
      doc.destroy();
      docRef.current = null;
    };
  }, [live, roomId]);

  const setBlocks = useCallback((next: DocBlock[]) => {
    const doc = docRef.current;
    if (doc) writeBlocks(doc, next); // the update observer refreshes React state + broadcasts
    else setLocal(next); // non-live fallback: plain local state
  }, []);

  return { blocks, setBlocks, live };
}
