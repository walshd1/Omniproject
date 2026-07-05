import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, mockReload } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { LabelsAdmin } from "./LabelsAdmin";

/**
 * Company-nomenclature panel: the entitlement gate (locked/unlocked), the catalog-driven
 * input list pre-filled from existing overrides, and the save round-trip (success reload,
 * failure toast) — none of this had a test file at all before.
 */
function seeded(catalog: Array<{ key: string; default: string }>, overrides: Record<string, string> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["labels", "admin"], { catalog, overrides });
  return qc;
}

const CATALOG = [
  { key: "project", default: "Project" },
  { key: "issue", default: "Task" },
];

afterEach(() => vi.restoreAllMocks());

describe("LabelsAdmin", () => {
  it("shows a lock notice and disables editing when not entitled", () => {
    renderWithProviders(<LabelsAdmin entitled={false} />, { client: seeded(CATALOG) });
    expect(screen.getByText(/Licensed feature/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Project")).toBeDisabled();
  });

  it("hides the lock notice and enables editing when entitled", () => {
    renderWithProviders(<LabelsAdmin entitled />, { client: seeded(CATALOG) });
    expect(screen.queryByText(/Licensed feature/i)).toBeNull();
    expect(screen.getByPlaceholderText("Project")).toBeEnabled();
  });

  it("renders one input per catalog term, pre-filled from existing overrides", () => {
    renderWithProviders(<LabelsAdmin entitled />, { client: seeded(CATALOG, { project: "Engagement" }) });
    expect(screen.getByDisplayValue("Engagement")).toBeInTheDocument(); // overridden
    expect(screen.getByPlaceholderText("Task")).toHaveValue(""); // not overridden, shows the default as a placeholder only
  });

  it("saves the edited overrides, toasts, and reloads the page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const reload = mockReload();
      const calls = mockFetchRouter({});
      renderWithProviders(<><LabelsAdmin entitled /><Toaster /></>, { client: seeded(CATALOG) });

      fireEvent.change(screen.getByPlaceholderText("Project"), { target: { value: "Engagement" } });
      fireEvent.click(screen.getByRole("button", { name: /save nomenclature/i }));

      await vi.waitFor(() => expect(screen.getByText("LABELS SAVED")).toBeInTheDocument());
      const putCall = calls.find((c) => c.init?.method === "PUT");
      expect(putCall).toBeTruthy();
      expect(JSON.parse(String(putCall!.init!.body))).toEqual({ overrides: { project: "Engagement" } });

      await vi.advanceTimersByTimeAsync(800);
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      // Guarantee real timers are restored even if an assertion above throws, so a failure
      // here can't leak fake timers into later tests.
      vi.useRealTimers();
    }
  });

  it("shows an error toast and never reloads when saving fails", async () => {
    const reload = mockReload();
    mockFetchRouter({ "/api/labels": { ok: false, status: 500, body: { error: "Storage unavailable" } } });
    renderWithProviders(<><LabelsAdmin entitled /><Toaster /></>, { client: seeded(CATALOG) });

    fireEvent.click(screen.getByRole("button", { name: /save nomenclature/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Storage unavailable")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
