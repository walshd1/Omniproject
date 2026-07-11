import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Comment-thread hooks over the (non-generated) `/api/comments/:roomId` feature-module endpoint —
 * modelled on lib/features.ts (react-query wrapping getJson/sendJson; CSRF is attached globally).
 * A "room" is the shared-surface id the backend + presence use, e.g. `issue:<projectId>:<issueId>`.
 */

export interface Comment {
  id: string;
  roomId: string;
  author: { sub: string; label: string };
  body: string;
  mentions: string[];
  createdAt: string;
}

export const commentsQueryKey = (roomId: string) => ["comments", roomId] as const;
const roomUrl = (roomId: string) => `/api/comments/${encodeURIComponent(roomId)}`;

/** The comment thread for a room, oldest first. */
export function useComments(roomId: string) {
  return useQuery({
    queryKey: commentsQueryKey(roomId),
    queryFn: () => getJson<{ comments: Comment[] }>(roomUrl(roomId)).then((r) => r.comments ?? []),
    staleTime: 10_000,
  });
}

/** Post a comment. `@mentions` in the body notify the mentioned user server-side (kind "mention"). */
export function useAddComment(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendJson<{ comment: Comment }>(roomUrl(roomId), { body }, "POST", "Failed to add comment"),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsQueryKey(roomId) }),
  });
}

/** Delete a comment (the author, or a pmo/admin — enforced server-side). */
export function useDeleteComment(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      sendJson(`${roomUrl(roomId)}/${encodeURIComponent(commentId)}`, undefined, "DELETE", "Failed to delete comment"),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsQueryKey(roomId) }),
  });
}
