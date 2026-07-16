import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CanvasElement } from "@workspace/backend-catalogue";
import { getJson, sendJson } from "./api";

/**
 * Whiteboard / visual-canvas client hooks over `/api/whiteboards/*` (roadmap 2.3). A board's scene is a list
 * of typed `canvas`-family primitives (sticky/shape/text/connector/frame) stored in the backend through the
 * broker seam (zero-at-rest), bounded + sanitised per-type server-side; these hooks read/write it. The native
 * canvas editor (built of those primitives) is a later slice — this is the data layer it builds on. Live
 * cursors reuse the collab relay under the room `board:<id>`.
 */

export type { CanvasElement } from "@workspace/backend-catalogue";
export interface WhiteboardScene { elements: CanvasElement[]; appState?: Record<string, unknown> }
/** Org-wide (shared) vs personal (owner-only) — the sidecar SoR persists + enforces this. */
export type WhiteboardVisibility = "org" | "user";
export interface WhiteboardMeta { id: string; name: string; projectId?: string | null; ownerSub?: string | null; visibility?: WhiteboardVisibility; updatedAt: string; updatedBy?: string | null }
export interface Whiteboard extends WhiteboardMeta { scene: WhiteboardScene }
export interface WhiteboardInput { name: string; scene: WhiteboardScene; projectId?: string | null; visibility?: WhiteboardVisibility }

/** The shared-surface room id a board uses for presence + live cursors (matches the server convention). */
export const whiteboardRoomId = (boardId: string) => `board:${boardId}`;

export const whiteboardsKey = (projectId?: string) => ["whiteboards", projectId ?? "all"] as const;
export const whiteboardKey = (id: string) => ["whiteboard", id] as const;

/** The whiteboards, optionally scoped to a project (scene bodies omitted — a listing). */
export function useWhiteboards(projectId?: string) {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return useQuery({ queryKey: whiteboardsKey(projectId), queryFn: () => getJson<WhiteboardMeta[]>(`/api/whiteboards${qs}`), staleTime: 15_000 });
}

/** One board with its scene. */
export function useWhiteboard(id: string | undefined) {
  return useQuery({
    queryKey: whiteboardKey(id ?? ""),
    queryFn: () => getJson<Whiteboard>(`/api/whiteboards/${encodeURIComponent(id!)}`),
    enabled: !!id,
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

/** Delete a board (manager+ server-side). */
export function useDeleteWhiteboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson(`/api/whiteboards/${encodeURIComponent(id)}`, undefined, "DELETE", "Failed to delete whiteboard"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whiteboards"] }),
  });
}
