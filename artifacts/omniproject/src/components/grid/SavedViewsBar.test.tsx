import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { SavedViewsBar } from "./SavedViewsBar";
import { savedViewsQueryKey, type SavedView } from "../../lib/saved-views";

const VIEWS: SavedView[] = [
  { id: "v1", name: "Triage", scope: "grid", columns: ["title", "status"] },
  { id: "v2", name: "Other scope", scope: "reports" },
];

function seed(views: SavedView[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(savedViewsQueryKey, views);
  return qc;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ views: VIEWS }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => vi.restoreAllMocks());

/** The PUT calls to /api/views (the save path), ignoring branding/refetch GETs. */
function viewPuts(): [string, RequestInit][] {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url, opts]) => url === "/api/views" && (opts as RequestInit | undefined)?.method === "PUT",
  ) as [string, RequestInit][];
}

describe("SavedViewsBar", () => {
  it("lists only views for the current scope", () => {
    renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />, { client: seed(VIEWS) });
    const select = screen.getByLabelText("Saved view") as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toContain("Triage");
    expect(labels).not.toContain("Other scope"); // scope=reports filtered out
  });

  it("applies a view when chosen", () => {
    const onApply = vi.fn();
    renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={onApply} />, { client: seed(VIEWS) });
    fireEvent.change(screen.getByLabelText("Saved view"), { target: { value: "v1" } });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", name: "Triage" }));
  });

  it("saves the current columns/sort as a new named view", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Sprint board");
    renderWithProviders(
      <SavedViewsBar scope="grid" current={{ columns: ["title", "status"], sort: { field: "status", dir: "asc" } }} onApply={() => {}} />,
      { client: seed(VIEWS) },
    );
    fireEvent.click(screen.getByRole("button", { name: /save view/i }));
    await waitFor(() => expect(viewPuts().length).toBeGreaterThan(0));
    const body = String(viewPuts().at(-1)![1].body);
    expect(body).toContain("Sprint board");
    expect(body).toContain("\"dir\":\"asc\"");
  });

  it("does not save when the prompt is cancelled/empty", () => {
    vi.spyOn(window, "prompt").mockReturnValue("   ");
    renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />, { client: seed(VIEWS) });
    fireEvent.click(screen.getByRole("button", { name: /save view/i }));
    expect(viewPuts().length).toBe(0); // no write to /api/views
  });

  it("deletes a view via the delete picker (after confirming the destructive action)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />, { client: seed(VIEWS) });
      fireEvent.change(screen.getByLabelText("Delete saved view"), { target: { value: "v1" } });
      expect(confirmSpy).toHaveBeenCalled();
      await waitFor(() => expect(viewPuts().length).toBeGreaterThan(0));
      // The remaining list sent back excludes the deleted id.
      expect(String(viewPuts().at(-1)![1].body)).not.toContain("Triage");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("does NOT delete when the confirm is declined", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />, { client: seed(VIEWS) });
      fireEvent.change(screen.getByLabelText("Delete saved view"), { target: { value: "v1" } });
      expect(confirmSpy).toHaveBeenCalled();
      // No PUT fired — the deletion was cancelled.
      await new Promise((r) => setTimeout(r, 20));
      expect(viewPuts().length).toBe(0);
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("does not apply when the placeholder (empty) option is chosen", () => {
    const onApply = vi.fn();
    renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={onApply} />, { client: seed(VIEWS) });
    // Selecting the "— choose —" option (value "") short-circuits the `e.target.value && apply` guard.
    fireEvent.change(screen.getByLabelText("Saved view"), { target: { value: "" } });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not delete when the placeholder (empty) delete option is chosen", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />, { client: seed(VIEWS) });
    fireEvent.change(screen.getByLabelText("Delete saved view"), { target: { value: "" } });
    // The `if (!id) return` guard means confirm is never reached and nothing is written.
    expect(confirmSpy).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 20));
    expect(viewPuts().length).toBe(0);
    confirmSpy.mockRestore();
  });

  it("hides the delete picker when the scope has no views", () => {
    // Only an out-of-scope view exists → the in-scope list is empty → no delete <select>.
    renderWithProviders(
      <SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />,
      { client: seed([{ id: "v2", name: "Other scope", scope: "reports" }]) },
    );
    expect(screen.queryByLabelText("Delete saved view")).not.toBeInTheDocument();
  });

  it("saves without a sort key when the current view is unsorted", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Unsorted view");
    renderWithProviders(
      <SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />,
      { client: seed(VIEWS) },
    );
    fireEvent.click(screen.getByRole("button", { name: /save view/i }));
    await waitFor(() => expect(viewPuts().length).toBeGreaterThan(0));
    const body = String(viewPuts().at(-1)![1].body);
    expect(body).toContain("Unsorted view");
    expect(body).not.toContain("\"sort\"");
  });

  it("surfaces a role=alert message when the save mutation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "Content-Type": "application/json" } })),
    );
    vi.spyOn(window, "prompt").mockReturnValue("Doomed view");
    renderWithProviders(<SavedViewsBar scope="grid" current={{ columns: ["title"], sort: null }} onApply={() => {}} />, { client: seed(VIEWS) });
    fireEvent.click(screen.getByRole("button", { name: /save view/i }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
  });
});
