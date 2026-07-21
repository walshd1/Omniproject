import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CanvasElement } from "@workspace/backend-catalogue";
import { getJson, sendJson } from "../../lib/api";
import { useFeatures, featureEnabled } from "../../lib/features";

/**
 * Whiteboard / visual-canvas client hooks over `/api/whiteboards/*` (roadmap 2.3). A board's scene is a list
 * of typed `canvas`-family primitives (sticky/shape/text/connector/frame) stored in an encrypted-JSON area
 * (or the sidecar SoR), bounded + sanitised per-type server-side; these hooks read/write it. The author picks
 * a STORAGE TARGET on create — their private area, a project's shared area, the org-wide area, or the sidecar
 * — and the returned id is self-describing so every later read/write routes to the right store. Live cursors
 * reuse the collab relay under the room `board:<id>`.
 */

export type { CanvasElement } from "@workspace/backend-catalogue";
export interface WhiteboardScene { elements: CanvasElement[]; appState?: Record<string, unknown> }
/** Org-wide (shared) vs personal (owner-only) — retained for the sidecar SoR's own model. */
export type WhiteboardVisibility = "org" | "user";
/**
 * Where a board is saved — the author's CHOICE (permission-gated server-side):
 *   - `user`     their PRIVATE encrypted-JSON area (default; only they see it).
 *   - `project`  a project's shared encrypted-JSON area (needs project access).
 *   - `org`      the org-wide shared encrypted-JSON area (writing needs manager+).
 *   - `sidecar`  the built-in system-of-record, when it's loaded.
 */
export type WhiteboardStorage = "user" | "project" | "org" | "sidecar";
export interface WhiteboardMeta { id: string; name: string; projectId?: string | null; ownerSub?: string | null; visibility?: WhiteboardVisibility; storage?: WhiteboardStorage; updatedAt: string; updatedBy?: string | null }
export interface Whiteboard extends WhiteboardMeta { scene: WhiteboardScene }
export interface WhiteboardInput { name: string; scene: WhiteboardScene; storage?: WhiteboardStorage; projectId?: string | null; visibility?: WhiteboardVisibility }

/** The shared-surface room id a board uses for presence + live cursors (matches the server convention). */
export const whiteboardRoomId = (boardId: string) => `board:${boardId}`;

export const whiteboardsKey = (projectId?: string) => ["whiteboards", projectId ?? "all"] as const;
export const whiteboardKey = (id: string) => ["whiteboard", id] as const;

/** The whiteboards, optionally scoped to a project (scene bodies omitted — a listing). Gated on the
 *  (default-off) `whiteboard` module — its router only mounts when the feature is on, so a features-off
 *  instance would otherwise 404-spam the console for boards it can't have. */
export function useWhiteboards(projectId?: string) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const enabled = featureEnabled(useFeatures().data, "whiteboard");
  return useQuery({ queryKey: whiteboardsKey(projectId), queryFn: () => getJson<WhiteboardMeta[]>(`/api/whiteboards${qs}`), enabled, staleTime: 15_000 });
}

/** One board with its scene. */
export function useWhiteboard(id: string | undefined) {
  const enabled = featureEnabled(useFeatures().data, "whiteboard");
  return useQuery({
    queryKey: whiteboardKey(id ?? ""),
    queryFn: () => getJson<Whiteboard>(`/api/whiteboards/${encodeURIComponent(id!)}`),
    enabled: !!id && enabled,
    staleTime: 10_000,
  });
}

/** Create a board (contributor+ server-side). */
export function useCreateWhiteboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WhiteboardInput) => sendJson<Whiteboard>("/api/whiteboards", input, "POST", "Failed to create whiteboard"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whiteboards"] }),
  });
}

/** Update a board (contributor+ server-side). */
export function useSaveWhiteboard(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WhiteboardInput) => sendJson<Whiteboard>(`/api/whiteboards/${encodeURIComponent(id)}`, input, "PUT", "Failed to save whiteboard"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: whiteboardKey(id) }); qc.invalidateQueries({ queryKey: ["whiteboards"] }); },
  });
}

/** Delete a board (contributor+ server-side; the org target additionally needs manager+). */
export function useDeleteWhiteboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson(`/api/whiteboards/${encodeURIComponent(id)}`, undefined, "DELETE", "Failed to delete whiteboard"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whiteboards"] }),
  });
}
