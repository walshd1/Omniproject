/**
 * Pure helpers for the comment composer's `@mention` typeahead.
 *
 * The overlay owns no user directory (identity lives in the IdP/SCIM, grants attach to groups), so there
 * is NO server API a normal author can call to list mention targets. The mention token is therefore
 * free-text — exactly what the gateway already parses server-side (`@[A-Za-z0-9._-]{1,64}`) and notifies
 * by sub/email. This typeahead is a pure convenience: it suggests handles drawn from the CURRENT thread's
 * own context (the people who have already commented + any tokens they've already been @-mentioned by), so
 * it never invents a directory and never leaks identity the client didn't already hold.
 */

import type { Comment } from "./comments";

/** The server's mention grammar: an @token is `[A-Za-z0-9._-]{1,64}` at a word boundary. Mirror it here so
 *  a suggested/inserted token is one the server will actually parse. */
const TOKEN_CHARS = "A-Za-z0-9._-";
const ACTIVE_MENTION_RE = new RegExp(`(^|\\s)@([${TOKEN_CHARS}]{0,64})$`);

export interface MentionCandidate {
  /** The token inserted after `@` (server-parseable). */
  token: string;
  /** A human label for the menu (the author's display name, or the token itself). */
  label: string;
}

/** Reduce a display label to a server-parseable token: keep only grammar chars, collapse the rest. */
export function labelToToken(label: string): string {
  const t = label.trim().replace(new RegExp(`[^${TOKEN_CHARS}]+`, "g"), "");
  return t.slice(0, 64);
}

/**
 * The mention candidates for a thread: every distinct comment author (label → token) plus every token any
 * comment has already been mentioned by. Deduped case-insensitively on the token; authors win the label.
 * Ordered authors-first (most useful), then orphan mention tokens.
 */
export function mentionCandidates(comments: readonly Comment[] | undefined): MentionCandidate[] {
  const byToken = new Map<string, MentionCandidate>();
  for (const c of comments ?? []) {
    const token = labelToToken(c.author?.label ?? "");
    if (token) {
      const key = token.toLowerCase();
      if (!byToken.has(key)) byToken.set(key, { token, label: c.author.label });
    }
  }
  for (const c of comments ?? []) {
    for (const m of c.mentions ?? []) {
      const token = labelToToken(m);
      if (!token) continue;
      const key = token.toLowerCase();
      if (!byToken.has(key)) byToken.set(key, { token, label: token });
    }
  }
  return [...byToken.values()];
}

/** The `@partial` being typed immediately before the caret, or null. `start` is the index of the `@`. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, Math.max(0, caret));
  const m = ACTIVE_MENTION_RE.exec(upto);
  if (!m) return null;
  const query = m[2] ?? "";
  const start = upto.length - query.length - 1; // index of the '@'
  return { start, query };
}

/** Filter candidates by the active query (case-insensitive prefix, then substring), capped for the menu. */
export function filterCandidates(candidates: readonly MentionCandidate[], query: string, limit = 6): MentionCandidate[] {
  const q = query.toLowerCase();
  if (!q) return candidates.slice(0, limit);
  const pref: MentionCandidate[] = [];
  const sub: MentionCandidate[] = [];
  for (const c of candidates) {
    const hay = `${c.token} ${c.label}`.toLowerCase();
    if (c.token.toLowerCase().startsWith(q) || c.label.toLowerCase().startsWith(q)) pref.push(c);
    else if (hay.includes(q)) sub.push(c);
  }
  return [...pref, ...sub].slice(0, limit);
}

/** Replace the active `@partial` (from `start` to `caret`) with `@token ` and return the new text + caret. */
export function applyMention(text: string, start: number, caret: number, token: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret);
  const insert = `@${token} `;
  return { text: before + insert + after, caret: before.length + insert.length };
}
