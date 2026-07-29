import { describe, it, expect } from "vitest";
import {
  labelToToken,
  mentionCandidates,
  activeMentionQuery,
  filterCandidates,
  applyMention,
} from "./mention-suggest";
import type { Comment } from "./comments";

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c",
    roomId: "issue:p1:i1",
    author: { sub: "u", label: "Alice" },
    body: "hi",
    mentions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("mention-suggest", () => {
  describe("labelToToken", () => {
    it("keeps grammar chars and drops the rest", () => {
      expect(labelToToken("Bob Smith")).toBe("BobSmith");
      expect(labelToToken("a.b_c-d")).toBe("a.b_c-d");
      expect(labelToToken("  spaced  ")).toBe("spaced");
    });
    it("caps at 64 chars", () => {
      expect(labelToToken("x".repeat(80))).toHaveLength(64);
    });
  });

  describe("mentionCandidates", () => {
    it("lists distinct authors first, then orphan mention tokens", () => {
      const cs = [
        comment({ author: { sub: "a", label: "Alice" } }),
        comment({ author: { sub: "b", label: "Bob" }, mentions: ["carol"] }),
        comment({ author: { sub: "a", label: "Alice" } }), // dup author
      ];
      const out = mentionCandidates(cs);
      expect(out.map((c) => c.token)).toEqual(["Alice", "Bob", "carol"]);
    });
    it("dedupes case-insensitively and is empty for no comments", () => {
      expect(mentionCandidates([])).toEqual([]);
      const out = mentionCandidates([comment({ author: { sub: "a", label: "Alice" }, mentions: ["alice"] })]);
      expect(out).toHaveLength(1);
    });
  });

  describe("activeMentionQuery", () => {
    it("detects an @token being typed at the caret", () => {
      expect(activeMentionQuery("hi @bo", 6)).toEqual({ start: 3, query: "bo" });
      expect(activeMentionQuery("@a", 2)).toEqual({ start: 0, query: "a" });
      expect(activeMentionQuery("hey @", 5)).toEqual({ start: 4, query: "" });
    });
    it("returns null when not in an @token", () => {
      expect(activeMentionQuery("hello world", 11)).toBeNull();
      expect(activeMentionQuery("email a@b", 9)).toBeNull(); // @ not at a word boundary
      expect(activeMentionQuery("@a done", 7)).toBeNull(); // caret past the token
    });
  });

  describe("filterCandidates", () => {
    const cands = mentionCandidates([
      comment({ author: { sub: "a", label: "Alice" } }),
      comment({ author: { sub: "b", label: "Bob" } }),
      comment({ author: { sub: "c", label: "Alastair" } }),
    ]);
    it("prefix-matches first, then substring", () => {
      expect(filterCandidates(cands, "al").map((c) => c.token)).toEqual(["Alice", "Alastair"]);
      expect(filterCandidates(cands, "").map((c) => c.token)).toEqual(["Alice", "Bob", "Alastair"]);
    });
  });

  describe("applyMention", () => {
    it("replaces the partial with '@token ' and moves the caret after it", () => {
      const r = applyMention("hi @bo done", 3, 6, "Bob");
      expect(r.text).toBe("hi @Bob  done");
      expect(r.caret).toBe(8); // right after "hi @Bob "
    });
  });
});
