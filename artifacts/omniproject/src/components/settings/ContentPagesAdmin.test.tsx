import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { contentPagesQueryKey } from "../../lib/content-pages";
import type { ContentPageDef } from "../../lib/content-pages";
import { ContentPagesAdmin } from "./ContentPagesAdmin";

function seed(role: string | undefined, pages: ContentPageDef[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { sub: "u1", role });
  qc.setQueryData(contentPagesQueryKey, pages);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("ContentPagesAdmin", () => {
  it("renders nothing for a non-PMO session", () => {
    renderWithProviders(<ContentPagesAdmin />, { client: seed("manager", []) });
    expect(screen.queryByTestId("content-pages-admin")).not.toBeInTheDocument();
  });

  it("shows the empty state with no pages", () => {
    renderWithProviders(<ContentPagesAdmin />, { client: seed("pmo", []) });
    expect(screen.getByTestId("content-pages-empty")).toBeInTheDocument();
  });

  it("adds a page, adds/reorders/removes components, and saves", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ contentPages: [] }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<ContentPagesAdmin />, { client: seed("pmo", []) });

    fireEvent.click(screen.getByText("+ page"));
    const nameInput = screen.getByLabelText("Content page 1 name");
    fireEvent.change(nameInput, { target: { value: "Exec view" } });

    const addSelect = screen.getByLabelText("Add component to Exec view");
    fireEvent.change(addSelect, { target: { value: "report:evm" } });
    expect(screen.getByTestId("content-page-0-component-0")).toHaveTextContent("Earned Value (EVM)");

    fireEvent.change(screen.getByLabelText("Add component to Exec view"), { target: { value: "widget:portfolioHealth" } });
    expect(screen.getByTestId("content-page-0-component-1")).toHaveTextContent("Portfolio health");

    // Reorder: move the second component up.
    fireEvent.click(screen.getByLabelText("Move Portfolio health up"));
    expect(screen.getByTestId("content-page-0-component-0")).toHaveTextContent("Portfolio health");

    // Remove one.
    fireEvent.click(screen.getByLabelText("Remove Earned Value (EVM) from Exec view"));
    expect(screen.queryByTestId("content-page-0-component-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Save content pages"));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/content-pages")).toBe(true));
    const [, init] = fetchMock.mock.calls.find((c) => c[0] === "/api/content-pages")!;
    expect((init as RequestInit).method).toBe("PUT");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.contentPages).toEqual([{ id: expect.any(String), name: "Exec view", componentIds: ["widget:portfolioHealth"] }]);
  });

  it("hides a report component the methodology composition curates out (widgets stay)", () => {
    const qc = seed("pmo", [{ id: "p1", name: "Exec view", componentIds: [] }]);
    // Curate to a set that excludes report:evm; widgets aren't composition items, so they remain.
    qc.setQueryData(["methodology-composition"], { methodologyComposition: ["report:portfolio-rag"] });
    renderWithProviders(<ContentPagesAdmin />, { client: qc });
    const options = Array.from(screen.getByLabelText("Add component to Exec view").querySelectorAll("option")).map((o) => o.textContent);
    expect(options.some((o) => o?.includes("Earned Value (EVM)"))).toBe(false); // curated out
    expect(options.some((o) => o?.includes("Portfolio health"))).toBe(true); // widget, always pickable
  });

  it("removes a page", () => {
    renderWithProviders(<ContentPagesAdmin />, {
      client: seed("pmo", [{ id: "p1", name: "Exec view", componentIds: [] }]),
    });
    expect(screen.getByTestId("content-page-edit-0")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remove page"));
    expect(screen.queryByTestId("content-page-edit-0")).not.toBeInTheDocument();
  });
});
