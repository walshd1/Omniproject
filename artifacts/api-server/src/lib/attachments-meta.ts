import { randomUUID } from "node:crypto";
import { envInt } from "./env-config";
import { sharedKv } from "./shared-state";
import { safeParseJson } from "./safe-json";

/**
 * Attachment POINTERS — the byte-free metadata plane for file attachments, stored in the EPHEMERAL
 * shared-state seam (in-process by default, fleet-wide when Redis is configured), keyed by the same
 * room-id convention comments/presence use (`issue:<projectId>:<issueId>` / `project:<projectId>`).
 *
 * This holds NO bytes — only a pointer: `{ id, filename, contentType, size, sha256, storageKey, author,
 * createdAt }`. The bytes live in the attachments-broker sidecar (below the seam) under `storageKey`.
 * Like comments, this is coordination state, not system-of-record data, so the zero-at-rest-above-the-seam
 * rule holds — and unlike comments there is deliberately no persistence import here at all; the pointer is
 * a plain JSON string on `sharedKv`.
 *
 * Pure-ish and broker-free, so it's unit-testable against the in-memory `sharedKv` with no server.
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
  /** The key the bytes live under in the attachments-broker (`/blob/<storageKey>`). */
  storageKey: string;
  author: AttachmentAuthor;
  /** ISO timestamp. */
  createdAt: string;
}

/** The pointer fields the caller supplies; id/roomId/author/createdAt are stamped by `addAttachment`. */
export type AttachmentInput = Pick<Attachment, "filename" | "contentType" | "size" | "sha256" | "storageKey">;

const PREFIX = "attachments:";
// Per-room attachment cap (oldest trimmed beyond it). Tunable for storage-governance needs.
const MAX_PER_ROOM = envInt("ATTACHMENTS_MAX_PER_ROOM", 200, { min: 1 });
const TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1-year soft retention in the ephemeral seam (bounds Redis growth)

const keyOf = (roomId: string, id: string) => `${PREFIX}${roomId}:${id}`;
const roomPrefix = (roomId: string) => `${PREFIX}${roomId}:`;

/** Parse ONE stored pointer back from the shared seam. When Redis-backed the value was written by another
 *  replica ⇒ untrusted input: parse prototype-safe and validate the WHOLE shape (including `author.sub`,
 *  which the route reads for the delete-authorization check). A malformed row is dropped (null). */
function safeParse(raw: string): Attachment | null {
  let o: unknown;
  try { o = safeParseJson<unknown>(raw); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const a = o as Record<string, unknown>;
  const author = a["author"];
  if (
    typeof a["id"] !== "string" || typeof a["roomId"] !== "string" ||
    typeof a["filename"] !== "string" || typeof a["contentType"] !== "string" ||
    typeof a["storageKey"] !== "string" || typeof a["sha256"] !== "string" ||
    typeof a["size"] !== "number" || !Number.isFinite(a["size"] as number)
  ) return null;
  if (!author || typeof author !== "object" || typeof (author as Record<string, unknown>)["sub"] !== "string") return null;
  const au = author as Record<string, unknown>;
  return {
    id: a["id"] as string,
    roomId: a["roomId"] as string,
    filename: a["filename"] as string,
    contentType: a["contentType"] as string,
    size: a["size"] as number,
    sha256: a["sha256"] as string,
    storageKey: a["storageKey"] as string,
    author: { sub: au["sub"] as string, label: typeof au["label"] === "string" ? (au["label"] as string) : "" },
    createdAt: typeof a["createdAt"] === "string" ? (a["createdAt"] as string) : "",
  };
}

/** A fresh, unique storage key for a new attachment's bytes (used as the sidecar `/blob/<key>`). */
export function newStorageKey(): string {
  return randomUUID().replace(/-/g, "");
}

/** Record a pointer to already-stored bytes. Stamps id + createdAt, stores it in the shared-state seam,
 *  and caps the room. Returns the stored pointer. */
export async function addAttachment(roomId: string, input: AttachmentInput, author: AttachmentAuthor, now: number): Promise<Attachment> {
  const att: Attachment = {
    id: randomUUID(),
    roomId,
    filename: input.filename,
    contentType: input.contentType,
    size: input.size,
    sha256: input.sha256,
    storageKey: input.storageKey,
    author,
    createdAt: new Date(now).toISOString(),
  };
  await sharedKv.set(keyOf(roomId, att.id), JSON.stringify(att), { ttlMs: TTL_MS });
  await capRoom(roomId);
  return att;
}

/** The room's attachments, newest first (stable — ties broken by id). */
export async function listAttachments(roomId: string): Promise<Attachment[]> {
  const entries = await sharedKv.list(roomPrefix(roomId));
  return entries
    .map((e) => safeParse(e.value))
    .filter((a): a is Attachment => !!a)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/** Read a single pointer (for the download + the delete-authorization check). */
export async function getAttachment(roomId: string, id: string): Promise<Attachment | null> {
  const raw = await sharedKv.get(keyOf(roomId, id));
  return raw ? safeParse(raw) : null;
}

/** Delete a pointer. Returns the deleted pointer (so the route can also drop the bytes), or null. */
export async function deleteAttachment(roomId: string, id: string): Promise<Attachment | null> {
  const att = await getAttachment(roomId, id);
  if (!att) return null;
  await sharedKv.del(keyOf(roomId, id));
  return att;
}

/** Drop the oldest pointers beyond the per-room cap (best-effort; keeps a hot room bounded). Returns the
 *  trimmed pointers so the caller can drop their bytes too. */
async function capRoom(roomId: string): Promise<Attachment[]> {
  const all = await listAttachments(roomId); // newest-first
  if (all.length <= MAX_PER_ROOM) return [];
  const overflow = all.slice(MAX_PER_ROOM); // oldest beyond the cap
  await Promise.all(overflow.map((a) => sharedKv.del(keyOf(roomId, a.id))));
  return overflow;
}
