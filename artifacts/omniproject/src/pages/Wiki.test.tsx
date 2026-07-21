import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { Wiki } from "./Wiki";

/** The wiki page: browse spaces/docs, read a doc, and RBAC-gate authoring. */
const SPACES = [{ id: "space-a", key: "a", name: "Space A" }];
const DOCS = [
  { id: "d1", spaceId: "space-a", parentId: null, slug: "d1", title: "Doc One", updatedAt: "" },
  { id: "d2", spaceId: "space-a", parentId: "d1", slug: "d2", title: "Doc Two", updatedAt: "" },
];
const DOC = { id: "d1", spaceId: "space-a", slug: "d1", title: "Doc One", updatedAt: "", blocks: [{ id: "b", type: "paragraph", text: "hello world" }], backlinks: [] };

const VERSIONS = [{ versionId: "v1", docId: "d1", at: "2026-07-01T00:00:00.000Z", author: "a@x", title: "Doc One" }];
function mockWikiFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    let body: unknown = {};
    if (url.endsWith("/api/wiki/spaces")) body = SPACES;
    else if (url.includes("/api/wiki/docs/d1/versions")) body = VERSIONS;
    else if (url.includes("/api/wiki/docs/d1")) body = DOC;
    else if (url.includes("/api/wiki/docs")) body = DOCS;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
}
function seed(role: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("Wiki page", () => {
  it("lists spaces + docs and renders a selected document with its blocks", async () => {
    mockWikiFetch();
    renderWithProviders(<Wiki />, { client: seed("viewer") });
    expect(await screen.findByTestId("space-space-a")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("doc-link-d1"));
    expect(await screen.findByText("hello world")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Doc One" })).toBeInTheDocument();
  });

  it("hides authoring controls from a viewer", async () => {
    mockWikiFetch();
    renderWithProviders(<Wiki />, { client: seed("viewer") });
    await screen.findByTestId("space-space-a");
    expect(screen.queryByTestId("wiki-new-doc")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("doc-link-d1"));
    await screen.findByText("hello world");
    expect(screen.queryByTestId("wiki-edit-doc")).not.toBeInTheDocument();
  });

  it("lets a contributor open the new-document editor", async () => {
    mockWikiFetch();
    renderWithProviders(<Wiki />, { client: seed("contributor") });
    fireEvent.click(await screen.findByTestId("wiki-new-doc"));
    expect(await screen.findByTestId("doc-editor")).toBeInTheDocument();
    expect(screen.getByTestId("block-palette")).toBeInTheDocument();
  });

  it("renders the doc list as a page tree, nesting a child under its parent", async () => {
    mockWikiFetch();
    renderWithProviders(<Wiki />, { client: seed("viewer") });
    const parent = await screen.findByTestId("doc-link-d1");
    const child = await screen.findByTestId("doc-link-d2");
    // Child is one level deeper than its parent (indentation carried on data-depth).
    expect(parent).toHaveAttribute("data-depth", "0");
    expect(child).toHaveAttribute("data-depth", "1");
  });

  it("toggles the version-history panel on the open document", async () => {
    mockWikiFetch();
    renderWithProviders(<Wiki />, { client: seed("viewer") });
    fireEvent.click(await screen.findByTestId("doc-link-d1"));
    await screen.findByText("hello world");
    fireEvent.click(screen.getByTestId("wiki-history-toggle"));
    expect(await screen.findByTestId("doc-history")).toBeInTheDocument();
    expect(await screen.findByTestId("history-version-v1")).toBeInTheDocument();
  });

  it("mounts the comments thread on the open document (doc:<id> room)", async () => {
    mockWikiFetch();
    renderWithProviders(<Wiki />, { client: seed("viewer") });
    fireEvent.click(await screen.findByTestId("doc-link-d1"));
    await screen.findByText("hello world");
    // The shared comments seam is wired in, keyed by the doc room (empty state when there are none).
    expect(await screen.findByTestId("comments")).toBeInTheDocument();
    expect(screen.getByText(/No comments yet/)).toBeInTheDocument();
  });

  it("shows an unsupported notice when the backend has no wiki (501)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "unsupported" }), { status: 501 })));
    renderWithProviders(<Wiki />, { client: seed("viewer") });
    expect(await screen.findByTestId("wiki-unsupported")).toBeInTheDocument();
  });
});
