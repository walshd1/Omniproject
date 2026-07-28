import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson, uploadFile } from "./api";
import { triggerBlobDownload } from "./setup";

/**
 * Attachment-thread hooks over the (non-generated) `/api/attachments/:roomId` feature-module endpoint —
 * the file-bytes sibling of lib/comments. A "room" is the shared-surface id (`issue:<projectId>:<issueId>`).
 * The gateway holds only a byte-free POINTER; the bytes live in the attachments-broker sidecar. Uploads POST
 * the raw file (via `uploadFile`); downloads fetch the `/blob` route and hand the bytes to a browser download.
 */

export interface AttachmentAuthor {
  sub: string;
  label: string;
}

export interface Attachment {
  id: string;
  roomId: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  storageKey: string;
  author: AttachmentAuthor;
  createdAt: string;
}

export const attachmentsQueryKey = (roomId: string) => ["attachments", roomId] as const;
const roomUrl = (roomId: string) => `/api/attachments/${encodeURIComponent(roomId)}`;

/** The room's attachments, newest first. */
export function useAttachments(roomId: string, enabled = true) {
  return useQuery({
    queryKey: attachmentsQueryKey(roomId),
    queryFn: () => getJson<{ attachments: Attachment[] }>(roomUrl(roomId)).then((r) => r.attachments ?? []),
    staleTime: 10_000,
    enabled,
  });
}

/** Upload a file to a room (contributor+). The raw bytes stream through the gateway to the sidecar. */
export function useUploadAttachment(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadFile<{ attachment: Attachment }>(roomUrl(roomId), file, "Failed to upload the file"),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentsQueryKey(roomId) }),
  });
}

/** Delete an attachment (the uploader, or a pmo/admin — enforced server-side). */
export function useDeleteAttachment(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      sendJson(`${roomUrl(roomId)}/${encodeURIComponent(id)}`, undefined, "DELETE", "Failed to delete the attachment"),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentsQueryKey(roomId) }),
  });
}

/** Fetch an attachment's bytes from the sidecar (via the gateway) and hand them to a browser download. */
export async function downloadAttachment(roomId: string, att: Pick<Attachment, "id" | "filename">): Promise<void> {
  const res = await fetch(`${roomUrl(roomId)}/${encodeURIComponent(att.id)}/blob`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not download the file");
  triggerBlobDownload(await res.blob(), att.filename);
}

/** Human-readable byte size (1024-based) for the attachment list. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
