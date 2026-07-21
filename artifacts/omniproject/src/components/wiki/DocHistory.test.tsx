import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { DocHistory } from "./DocHistory";
import type { WikiDoc } from "../../lib/wiki";

/** The version-history panel: list revisions, diff a revision vs the current doc, restore via the save path. */
const CURRENT: WikiDoc = {
  id: "d1", spaceId: "s1", parentId: null, slug: "d1", title: "Doc", updatedAt: "",
  blocks: [{ id: "b1", type: "paragraph", text: "new text" }],
};
const VERSIONS = [
  { versionId: "v2", docId: "d1", at: "2026-07-02T00:00:00.000Z", author: "a@x", title: "Doc" },
  { versionId: "v1", docId: "d1", at: "2026-07-01T00:00:00.000Z", author: "a@x", title: "Doc" },
];
const V1_FULL = { versionId: "v1", docId: "d1", at: "2026-07-01T00:00:00.000Z", author: "a@x", title: "Doc", blocks: [{ id: "b1", type: "paragraph", text: "old text" }] };

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    let body: unknown = {};
    let status = 200;
    if (url.includes("/versions/v1")) body = V1_FULL;
    else if (url.endsWith("/versions")) body = VERSIONS;
    else { status = 404; body = { error: "nope" }; }
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
}
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

afterEach(() => vi.restoreAllMocks());

describe("DocHistory", () => {
  it("lists revisions and diffs a selected one against the current document, then restores it", async () => {
    mockFetch();
    const onRestore = vi.fn();
    renderWithProviders(<DocHistory docId="d1" current={CURRENT} canRestore restoring={false} onRestore={onRestore} onClose={() => {}} />, { client: qc() });

    // The revisions list loads (newest first).
    expect(await screen.findByTestId("history-version-v2")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("history-version-v1"));

    // The diff summary reports the one changed block (b1: "old text" → "new text").
    const summary = await screen.findByTestId("history-diff-summary");
    expect(summary).toHaveTextContent(/1 changed/);

    fireEvent.click(screen.getByTestId("history-restore"));
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(onRestore.mock.calls[0]![0]).toMatchObject({ versionId: "v1" });
  });

  it("hides the restore control when the user cannot author", async () => {
    mockFetch();
    renderWithProviders(<DocHistory docId="d1" current={CURRENT} canRestore={false} onRestore={() => {}} onClose={() => {}} />, { client: qc() });
    fireEvent.click(await screen.findByTestId("history-version-v1"));
    await screen.findByTestId("history-diff-summary");
    expect(screen.queryByTestId("history-restore")).not.toBeInTheDocument();
  });

  it("shows an unavailable notice when the backend does not retain history (501)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: "no history" }), { status: 501 })));
    renderWithProviders(<DocHistory docId="d1" current={CURRENT} canRestore onRestore={() => {}} onClose={() => {}} />, { client: qc() });
    expect(await screen.findByTestId("history-unavailable")).toBeInTheDocument();
  });
});
