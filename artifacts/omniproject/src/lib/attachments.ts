import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { triggerBlobDownload } from "./setup";

/**
 * Attachment-thread hooks over the (non-generated) `/api/attachments/:roomId` feature-module endpoint —
 * the file-bytes sibling of lib/comments. A "room" is the shared-surface id (`issue:<projectId>:<issueId>`).
 *
 * The gateway NEVER handles a file's bytes: it holds only a byte-free POINTER and mints short-lived,
 * signed tickets. The BYTES travel browser↔sidecar DIRECTLY — on upload the browser mints a ticket, PUTs
 * the file straight to the attachments-broker's portal, then records the returned metadata; on download it
 * mints a link and fetches the bytes straight from the sidecar. So a (possibly malicious) upload only ever
 * exists inside the hardened, isolated sidecar container — never in the gateway.
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

/** The gateway's reply to a mint-upload-ticket request — a one-shot, direct-to-sidecar upload URL. */
interface UploadTicket {
  storageKey: string;
  uploadUrl: string;
  expiresAt: number;
  maxBytes: number;
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

/**
 * Upload a file to a room (contributor+) WITHOUT the bytes ever touching the gateway:
 *   1. mint an upload ticket from the gateway (metadata only → a direct-to-sidecar URL);
 *   2. PUT the file straight to the sidecar's portal (cross-origin, ticket-authorised, no cookies/CSRF —
 *      the ticket IS the capability), which returns the sidecar-computed size + sha256;
 *   3. record the pointer on the gateway, which HEAD-verifies the blob landed.
 */
export async function uploadViaSidecar(roomId: string, file: File): Promise<Attachment> {
  const contentType = file.type || "application/octet-stream";
  const ticket = await sendJson<UploadTicket>(
    `${roomUrl(roomId)}/upload-ticket`,
    { filename: file.name, size: file.size },
    "POST",
    "Failed to start the upload",
  );
  // Direct, cross-origin PUT to the sidecar portal — deliberately a bare fetch with no credentials, so no
  // cookie or CSRF header is ever sent off-origin; the signed ticket in the URL is the sole authorisation.
  const put = await fetch(ticket.uploadUrl, {
    method: "PUT",
    body: file,
    headers: { "content-type": contentType },
  });
  if (!put.ok) throw new Error("Failed to upload the file to the attachments service");
  const stored = (await put.json().catch(() => ({}))) as { sha256?: string };
  if (!stored.sha256) throw new Error("The attachments service did not confirm the upload");
  const res = await sendJson<{ attachment: Attachment }>(
    roomUrl(roomId),
    { storageKey: ticket.storageKey, filename: file.name, contentType, sha256: stored.sha256 },
    "POST",
    "Failed to record the file",
  );
  return res.attachment;
}

/** Upload a file to a room (contributor+). Bytes go browser↔sidecar directly; see `uploadViaSidecar`. */
export function useUploadAttachment(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadViaSidecar(roomId, file),
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

/**
 * Download an attachment's bytes DIRECTLY from the sidecar (never via the gateway): mint a one-shot link
 * from the gateway, then fetch the bytes straight from the sidecar's CORS-enabled portal and hand them to a
 * browser download.
 */
export async function downloadAttachment(roomId: string, att: Pick<Attachment, "id" | "filename">): Promise<void> {
  const { url } = await getJson<{ url: string }>(`${roomUrl(roomId)}/${encodeURIComponent(att.id)}/link`);
  // Cross-origin to the sidecar portal — a bare fetch (no credentials); the ticket in the URL authorises it.
  const res = await fetch(url);
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
