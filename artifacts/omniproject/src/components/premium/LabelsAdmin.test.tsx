import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, mockReload } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { LabelsAdmin } from "./LabelsAdmin";

/**
 * Company-nomenclature panel: role-gated (PMO/admin only, not premium-entitled), the catalog-driven
 * input list pre-filled from existing overrides, and the save round-trip (success reload, failure
 * toast). Nomenclature is a standard governance knob — any PMO or admin can edit it.
 */
let role = "admin";
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ data: { role } }),
  isPmoOrAdmin: (r?: string) => r === "admin" || r === "pmo",
}));

function seeded(catalog: Array<{ key: string; default: string }>, overrides: Record<string, string> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["labels", "admin"], { catalog, overrides });
  return qc;
}

const CATALOG = [
  { key: "term.project", default: "Project" },
  { key: "term.issue", default: "Issue" },
];

afterEach(() => { role = "admin"; vi.restoreAllMocks(); });

describe("LabelsAdmin", () => {
  it("is hidden for a non-PMO/admin role", () => {
    role = "contributor";
    renderWithProviders(<LabelsAdmin />, { client: seeded(CATALOG) });
    expect(screen.queryByText(/Company nomenclature/i)).toBeNull();
  });

  it("a PMO sees the editable panel (no licence gate)", () => {
    role = "pmo";
    renderWithProviders(<LabelsAdmin />, { client: seeded(CATALOG) });
    expect(screen.getByText(/Company nomenclature/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Project")).toBeEnabled();
  });

  it("renders one input per catalog term, pre-filled from existing overrides", () => {
    renderWithProviders(<LabelsAdmin />, { client: seeded(CATALOG, { "term.project": "Engagement" }) });
    expect(screen.getByDisplayValue("Engagement")).toBeInTheDocument(); // overridden
    expect(screen.getByPlaceholderText("Issue")).toHaveValue(""); // not overridden, shows the default as a placeholder only
  });

  it("saves the edited overrides, toasts, and reloads the page", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const reload = mockReload();
      const calls = mockFetchRouter({});
      renderWithProviders(<><LabelsAdmin /><Toaster /></>, { client: seeded(CATALOG) });

      fireEvent.change(screen.getByPlaceholderText("Project"), { target: { value: "Engagement" } });
      fireEvent.click(screen.getByRole("button", { name: /save nomenclature/i }));

      await vi.waitFor(() => expect(screen.getByText("LABELS SAVED")).toBeInTheDocument());
      const putCall = calls.find((c) => c.init?.method === "PUT");
      expect(putCall).toBeTruthy();
      expect(JSON.parse(String(putCall!.init!.body))).toEqual({ overrides: { "term.project": "Engagement" } });

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
    renderWithProviders(<><LabelsAdmin /><Toaster /></>, { client: seeded(CATALOG) });

    fireEvent.click(screen.getByRole("button", { name: /save nomenclature/i }));

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Storage unavailable")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});
