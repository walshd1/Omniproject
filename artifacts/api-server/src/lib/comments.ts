import { randomUUID } from "node:crypto";
import { sharedKv } from "./shared-state";
import { safeParseJson } from "./safe-json";

/**
 * Comment threads — lightweight collaboration on a work item, stored in the EPHEMERAL shared-state
 * seam (in-process by default, fleet-wide when Redis is configured), keyed by the same room-id
 * convention presence uses (`issue:<projectId>:<issueId>` / `project:<projectId>`).
 *
 * This is deliberately "in memory, optionally persisted": comments live in `sharedKv` — coordination
 * state, not system-of-record data, so the zero-at-rest-above-the-seam rule holds. Durability is an
 * OPT-IN write-through to a backend (a `note` TaskItem via the neutral broker seam) handled by the
 * route; the store itself never touches a database or the broker. A soft TTL bounds growth, and each
 * room is capped, so an unbounded thread can't exhaust memory.
 *
 * Pure-ish and broker-free, so it's unit-testable against the in-memory `sharedKv` with no server.
 */

export interface CommentAuthor {
  sub: string;
  label: string;
}

export interface Comment {
  id: string;
  roomId: string;
  author: CommentAuthor;
  body: string;
  /** @mentions parsed from the body (bare tokens; the route resolves them to notification targets). */
  mentions: string[];
  /** ISO timestamp. */
  createdAt: string;
}

const PREFIX = "comments:";
const MAX_PER_ROOM = 500;
const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90-day soft retention in the ephemeral seam (bounds Redis growth)

const keyOf = (roomId: string, id: string) => `${PREFIX}${roomId}:${id}`;
const roomPrefix = (roomId: string) => `${PREFIX}${roomId}:`;

/** Extract @mentions from a body: `@token` where token is `[A-Za-z0-9._-]` (1–64 chars), at a word
 *  boundary. Deduped and bounded so a pathological body can't fan out unboundedly. */
export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(?:^|[^A-Za-z0-9._-])@([A-Za-z0-9._-]{1,64})/g)) out.add(m[1]!);
  return [...out].slice(0, 50);
}

/** Parse ONE stored comment back from the shared seam. When Redis-backed the value was written by
 *  another replica ⇒ untrusted input: parse prototype-safe and validate the WHOLE shape — including
 *  `author.sub`, which the route reads for the delete-authorization check — so a poisoned/partial row
 *  can't type-confuse that check or ride a prototype key through. A malformed row is dropped (null). */
function safeParse(raw: string): Comment | null {
  let o: unknown;
  try { o = safeParseJson<unknown>(raw); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const c = o as Record<string, unknown>;
  const author = c["author"];
  if (typeof c["id"] !== "string" || typeof c["roomId"] !== "string" || typeof c["body"] !== "string") return null;
  if (!author || typeof author !== "object" || typeof (author as Record<string, unknown>)["sub"] !== "string") return null;
  const a = author as Record<string, unknown>;
  return {
    id: c["id"] as string,
    roomId: c["roomId"] as string,
    author: { sub: a["sub"] as string, label: typeof a["label"] === "string" ? (a["label"] as string) : "" },
    body: c["body"] as string,
    mentions: Array.isArray(c["mentions"]) ? (c["mentions"] as unknown[]).filter((m): m is string => typeof m === "string") : [],
    createdAt: typeof c["createdAt"] === "string" ? (c["createdAt"] as string) : "",
  };
}

/** Add a comment to a room's thread. Parses @mentions, stamps id + createdAt, stores it in the
 *  shared-state seam, and caps the room. Returns the stored comment. */
export async function addComment(roomId: string, author: CommentAuthor, body: string, now: number): Promise<Comment> {
  const comment: Comment = {
    id: randomUUID(),
    roomId,
    author,
    body,
    mentions: parseMentions(body),
    createdAt: new Date(now).toISOString(),
  };
  await sharedKv.set(keyOf(roomId, comment.id), JSON.stringify(comment), { ttlMs: TTL_MS });
  await capRoom(roomId);
  return comment;
}

/** The room's thread, oldest first (stable — ties broken by id). */
export async function listComments(roomId: string): Promise<Comment[]> {
  const entries = await sharedKv.list(roomPrefix(roomId));
  return entries
    .map((e) => safeParse(e.value))
    .filter((c): c is Comment => !!c)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

/** Read a single comment (for the authorization check on delete). */
export async function getComment(roomId: string, commentId: string): Promise<Comment | null> {
  const raw = await sharedKv.get(keyOf(roomId, commentId));
  return raw ? safeParse(raw) : null;
}

/** Delete a comment. Returns the deleted comment, or null if it didn't exist. */
export async function deleteComment(roomId: string, commentId: string): Promise<Comment | null> {
  const comment = await getComment(roomId, commentId);
  if (!comment) return null;
  await sharedKv.del(keyOf(roomId, commentId));
  return comment;
}

/** Drop the oldest comments beyond the per-room cap (best-effort; keeps a hot thread bounded). */
async function capRoom(roomId: string): Promise<void> {
  const all = await listComments(roomId);
  if (all.length <= MAX_PER_ROOM) return;
  const overflow = all.slice(0, all.length - MAX_PER_ROOM); // oldest-first prefix
  await Promise.all(overflow.map((c) => sharedKv.del(keyOf(roomId, c.id))));
}
