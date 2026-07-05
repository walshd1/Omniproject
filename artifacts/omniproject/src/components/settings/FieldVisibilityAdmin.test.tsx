import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter } from "../../test/utils";
import { availabilityQueryKey, type Availability } from "../../lib/availability";
import { FieldVisibilityAdmin } from "./FieldVisibilityAdmin";

/**
 * Admin/PMO field-visibility curation panel: it can only HIDE fields the backend already
 * makes available, never reveal what the backend lacks — so every assertion here is scoped
 * to `availability.available`, not the canonical field catalogue.
 */
const AVAIL: Availability = {
  source: "manifest",
  fields: ["title", "status"],
  available: ["title", "status", "dueDate"],
  hidden: ["dueDate"],
  tables: [],
  relationships: [],
};

function seeded(availability: Availability): QueryClient {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  qc.setQueryData(availabilityQueryKey, availability);
  return qc;
}

describe("FieldVisibilityAdmin", () => {
  it("renders nothing until availability has loaded", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderWithProviders(<FieldVisibilityAdmin />, { client: qc });
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every available field, marking curated-hidden ones distinctly from shown ones", () => {
    renderWithProviders(<FieldVisibilityAdmin />, { client: seeded(AVAIL) });
    const summary = screen.getByTestId("field-visibility").textContent ?? "";
    expect(summary).toContain("3"); // availability.available.length
    expect(summary).toContain("source: manifest");
    expect(summary).toContain("Hidden: 1");

    const shown = screen.getByRole("button", { name: /^title/i });
    expect(shown).toHaveAttribute("aria-pressed", "true");
    const hidden = screen.getByRole("button", { name: /^dueDate/i });
    expect(hidden).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a fallback message when the backend has no available fields", () => {
    renderWithProviders(<FieldVisibilityAdmin />, {
      client: seeded({ ...AVAIL, available: [], hidden: [] }),
    });
    expect(screen.getByText(/no fields available/i)).toBeInTheDocument();
  });

  it("hides a shown field: PATCHes the full next hidden set and reflects the refetched state", async () => {
    const calls = mockFetchRouter({
      "/api/availability/curation": { ok: true, body: {} },
      "/api/availability": { ok: true, body: { ...AVAIL, hidden: ["dueDate", "title"] } },
    });
    renderWithProviders(<FieldVisibilityAdmin />, { client: seeded(AVAIL) });

    fireEvent.click(screen.getByRole("button", { name: /^title/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^title/i })).toHaveAttribute("aria-pressed", "false"));
    const patchCall = calls.find((c) => c.init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(String(patchCall!.init!.body))).toEqual({ hiddenFields: ["dueDate", "title"] });
  });

  it("un-hides a hidden field: PATCHes the next set with it removed", async () => {
    const calls = mockFetchRouter({
      "/api/availability/curation": { ok: true, body: {} },
      "/api/availability": { ok: true, body: { ...AVAIL, hidden: [] } },
    });
    renderWithProviders(<FieldVisibilityAdmin />, { client: seeded(AVAIL) });

    fireEvent.click(screen.getByRole("button", { name: /^dueDate/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /^dueDate/i })).toHaveAttribute("aria-pressed", "true"));
    const patchCall = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(String(patchCall!.init!.body))).toEqual({ hiddenFields: [] });
  });
});
