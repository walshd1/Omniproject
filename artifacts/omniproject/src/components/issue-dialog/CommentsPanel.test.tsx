import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { CommentsPanel } from "./CommentsPanel";
import { commentsQueryKey, type Comment } from "../../lib/comments";

/** CommentsPanel renders the room's thread (seeded via the query cache) + an add form. */
describe("CommentsPanel", () => {
  function seed(roomId: string, comments: Comment[]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(commentsQueryKey(roomId), comments);
    return qc;
  }

  it("renders the seeded thread with author + body", () => {
    const qc = seed("issue:p1:i1", [
      { id: "c1", roomId: "issue:p1:i1", author: { sub: "u", label: "Alice" }, body: "please review @bob", mentions: ["bob"], createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i1" />, { client: qc });
    expect(screen.getByText(/please review @bob/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no comments", () => {
    const qc = seed("issue:p1:i2", []);
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i2" />, { client: qc });
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });
});
