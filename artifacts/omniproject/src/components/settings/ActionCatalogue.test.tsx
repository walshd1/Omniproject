import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ActionCatalogue } from "./ActionCatalogue";
import type { CatalogueAction } from "../../lib/actions";

/** AI action catalogue: admin-only; lists actions with approve/block toggles. */
const ACTIONS: CatalogueAction[] = [
  { action: "list_projects", label: "omniproject_list_projects", description: "List projects.", write: false, approved: true },
  { action: "update_issue", label: "omniproject_update_issue", description: "Update an item.", write: true, approved: false },
];

function seed(role: string | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(["action-catalogue"], { actions: ACTIONS });
  return qc;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ actions: ACTIONS }) }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => vi.unstubAllGlobals());

describe("ActionCatalogue", () => {
  it("is hidden for a non-admin", () => {
    renderWithProviders(<ActionCatalogue />, { client: seed("viewer") });
    expect(screen.queryByTestId("action-catalogue")).not.toBeInTheDocument();
  });

  it("lists reads and writes with their approved state", () => {
    renderWithProviders(<ActionCatalogue />, { client: seed("admin") });
    expect(screen.getByTestId("approve-list_projects")).toHaveTextContent("approved");
    expect(screen.getByTestId("approve-update_issue")).toHaveTextContent("blocked");
    expect(screen.getByText("write")).toBeInTheDocument();
  });

  it("approves a blocked write action via PUT", async () => {
    renderWithProviders(<ActionCatalogue />, { client: seed("admin") });
    fireEvent.click(screen.getByTestId("approve-update_issue"));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/governance/approved"));
      expect(call).toBeTruthy();
      expect((call![1] as { method: string }).method).toBe("PUT");
      expect(JSON.parse((call![1] as { body: string }).body)).toEqual({ actions: ["update_issue"] });
    });
  });
});
