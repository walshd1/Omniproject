import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { CommentsPanel } from "./CommentsPanel";
import { Toaster } from "../ui/toaster";
import { commentsQueryKey, type Comment } from "../../lib/comments";

/** CommentsPanel renders the room's thread (seeded via the query cache) + an add form. */
describe("CommentsPanel", () => {
  function seed(roomId: string, comments: Comment[]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
    qc.setQueryData(commentsQueryKey(roomId), comments);
    return qc;
  }

  const COMMENT: Comment = {
    id: "c1",
    roomId: "issue:p1:i1",
    author: { sub: "u", label: "Alice" },
    body: "please review @bob",
    mentions: ["bob"],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  /** Capture-and-canned fetch stub: records every call, returns `ok` with the given JSON body. */
  function stubFetch(handler: (url: string, init?: RequestInit) => { ok: boolean; status?: number; body?: unknown }) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = handler(String(url), init);
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        statusText: r.ok ? "OK" : "Error",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve(r.body ?? {}),
        text: () => Promise.resolve(JSON.stringify(r.body ?? {})),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  afterEach(() => resetFetchMock());

  it("renders the seeded thread with author + body", () => {
    const qc = seed("issue:p1:i1", [COMMENT]);
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i1" />, { client: qc });
    expect(screen.getByText(/please review @bob/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    // Every comment offers a Delete control.
    expect(screen.getByRole("button", { name: "Delete comment" })).toBeInTheDocument();
  });

  it("shows the empty state when there are no comments", () => {
    const qc = seed("issue:p1:i2", []);
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i2" />, { client: qc });
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  it("disables the Comment button until there is non-whitespace text", () => {
    const qc = seed("issue:p1:i1", []);
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i1" />, { client: qc });
    const button = screen.getByRole("button", { name: "Comment" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText("New comment"), { target: { value: "  " } });
    expect(button).toBeDisabled(); // whitespace only
    fireEvent.change(screen.getByLabelText("New comment"), { target: { value: "real" } });
    expect(button).toBeEnabled();
  });

  it("posts a trimmed comment and clears the input on success", async () => {
    const qc = seed("issue:p1:i1", []);
    const calls = stubFetch((url) =>
      url.includes("/api/comments") ? { ok: true, body: { comment: COMMENT } } : { ok: true, body: { comments: [] } },
    );
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i1" />, { client: qc });
    const input = screen.getByLabelText("New comment") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  looks good  " } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() => {
      const post = calls.find((c) => (c.init?.method ?? "GET") === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post!.init!.body)).body).toBe("looks good"); // trimmed
    });
    await waitFor(() => expect(input.value).toBe("")); // cleared on success
  });

  it("does not submit an empty comment (guard on the form submit)", () => {
    const qc = seed("issue:p1:i1", []);
    const calls = stubFetch(() => ({ ok: true, body: { comments: [] } }));
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i1" />, { client: qc });
    // Submit the form directly with an empty body — the guard returns before mutating.
    fireEvent.submit(screen.getByLabelText("New comment").closest("form")!);
    expect(calls.some((c) => (c.init?.method ?? "GET") === "POST")).toBe(false);
  });

  it("surfaces an error toast when adding a comment fails", async () => {
    const qc = seed("issue:p1:i1", []);
    stubFetch((url) =>
      url.includes("/api/comments") ? { ok: false, status: 500, body: { error: "nope" } } : { ok: true, body: { comments: [] } },
    );
    renderWithProviders(<><CommentsPanel projectId="p1" issueId="i1" /><Toaster /></>, { client: qc });
    fireEvent.change(screen.getByLabelText("New comment"), { target: { value: "will fail" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(await screen.findByText("nope")).toBeInTheDocument();
  });

  it("deletes a comment through the delete endpoint", async () => {
    const qc = seed("issue:p1:i1", [COMMENT]);
    const calls = stubFetch(() => ({ ok: true, body: { comments: [] } }));
    renderWithProviders(<CommentsPanel projectId="p1" issueId="i1" />, { client: qc });
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    await waitFor(() => {
      const del = calls.find((c) => (c.init?.method ?? "GET") === "DELETE");
      expect(del).toBeTruthy();
      expect(del!.url).toContain("c1");
    });
  });

});
