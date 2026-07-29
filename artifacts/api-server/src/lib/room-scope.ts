import type { Request, Response } from "express";
import { parseScopedId } from "./artifact-store";
import { guardProjectScope } from "./project-scope";

/**
 * The projectId a realtime room is scoped to, or null when the room has no project boundary.
 *
 * The realtime surfaces (comments, attachments, presence, wiki co-edit) share an in-memory hub keyed ONLY
 * by roomId, so the route MUST resolve a room's project and enforce the caller's scope (an IDOR guard)
 * before joining. Two room-id shapes carry a project:
 *   - `issue:<projectId>:<issueId>` / `project:<projectId>` — the projectId is the first segment.
 *   - `doc:<scopedId>` / `board:<scopedId>` — the id is SELF-DESCRIBING (`project~<projectId>~<localId>`).
 *     A `project`-storage artifact is project-private — its BODY is gated by `guardProjectScope` (see
 *     storage-target-authz.ts) — so its collaboration room must be gated the same way. `user`/`org`/
 *     `sidecar` artifacts have no project boundary and stay unscoped (org-content collaboration).
 *
 * Mirrors `roomBoardProjectId` in routes/whiteboard.ts, kept in ONE place so the shared-hub routes can't
 * drift: they previously recognized only `issue:`/`project:` and FAILED OPEN on a `doc:project~…` room,
 * exposing a project doc's comment thread, attachment download tickets, presence roster, and live co-edit
 * CRDT stream to any authenticated principal outside the project's scope.
 */
export function projectIdOfRoom(roomId: string): string | null {
  const idx = roomId.indexOf(":");
  if (idx < 0) return null;
  const kind = roomId.slice(0, idx);
  const rest = roomId.slice(idx + 1);
  if (!rest) return null;
  if (kind === "issue" || kind === "project") return rest.split(":")[0] || null;
  if (kind === "doc" || kind === "board") {
    const parsed = parseScopedId(rest);
    return parsed?.storage === "project" ? (parsed.projectId ?? null) : null;
  }
  return null;
}

/** Enforce the caller's project scope on a room whose id encodes a projectId (IDOR guard); a room with no
 *  project boundary (`user`/`org`/`sidecar` content) is allowed through. */
export async function guardRoomScope(req: Request, res: Response, roomId: string): Promise<boolean> {
  const projectId = projectIdOfRoom(roomId);
  return projectId ? guardProjectScope(req, res, projectId) : true;
}
