import type { Whiteboard, WhiteboardWrite, WhiteboardVisibility } from "./types";
import type { ActorContext } from "./types";

/**
 * Shared, PURE ownership rules for whiteboards, used by EVERY broker (demo + built-in sidecar) so org-wide
 * vs personal behaviour can't drift between them. An `org` board is visible/editable to anyone (the route's
 * viewer/contributor RBAC gate still applies on top); a `user` (personal) board only to its `ownerSub`.
 * Fail-closed: an unattributable personal board is hidden even from an anonymous caller.
 */
export function whiteboardVisibleTo(board: Pick<Whiteboard, "visibility" | "ownerSub">, sub: string | undefined): boolean {
  return board.visibility !== "user" || (!!sub && board.ownerSub === sub);
}

/** Normalise a requested visibility to the stored value (anything but "user" is org-wide). */
export function normalizeVisibility(v: WhiteboardVisibility | undefined): WhiteboardVisibility {
  return v === "user" ? "user" : "org";
}

/**
 * Build the row for a NEW board from a write + the caller's context: the owner is stamped from `ctx.sub`
 * (never the client), visibility normalised, timestamps set. The caller supplies the fresh id.
 */
export function newWhiteboardRow(ctx: ActorContext, id: string, input: WhiteboardWrite, now: string): Whiteboard {
  return {
    id,
    name: input.name,
    projectId: input.projectId ?? null,
    ownerSub: ctx.sub ?? null,
    visibility: normalizeVisibility(input.visibility),
    scene: input.scene,
    updatedAt: now,
    updatedBy: ctx.email ?? ctx.name ?? ctx.sub ?? null,
  };
}

/** Apply an UPDATE to an existing board, PRESERVING its owner (ownership never transfers via a write). */
export function mergeWhiteboardUpdate(existing: Whiteboard, ctx: ActorContext, input: WhiteboardWrite, now: string): Whiteboard {
  return {
    ...existing,
    name: input.name,
    projectId: input.projectId ?? null,
    visibility: normalizeVisibility(input.visibility),
    ownerSub: existing.ownerSub ?? null, // preserved — a write can't change the owner
    scene: input.scene,
    updatedAt: now,
    updatedBy: ctx.email ?? ctx.name ?? ctx.sub ?? null,
  };
}
