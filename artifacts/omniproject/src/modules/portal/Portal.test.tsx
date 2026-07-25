import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { Portal } from "./Portal";

/** The client-facing portal: a guest sees its one project's curated status; anyone else sees a notice. */
const STATUS = {
  project: { id: "proj-001", name: "Platform Rewrite", description: "Overhaul of the core platform." },
  progress: { total: 10, done: 4, percent: 40 },
  health: { red: 1, amber: 2, green: 5 },
  milestones: [{ title: "Cutover", status: "in_progress", dueDate: "2026-08-01" }],
};

function seed(role: string, guest?: { projectId: string; tier: string }): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" }, ...(guest ? { guest } : {}) });
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("Portal page", () => {
  it("renders the guest's curated project status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/portal/status")) return Promise.resolve(new Response(JSON.stringify(STATUS), { status: 200 }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    renderWithProviders(<Portal />, { client: seed("guest", { projectId: "proj-001", tier: "read" }) });
    expect(await screen.findByRole("heading", { name: /platform rewrite/i })).toBeInTheDocument();
    expect(await screen.findByTestId("portal-percent")).toHaveTextContent("40%");
    expect(screen.getByTestId("portal-milestones")).toHaveTextContent("Cutover");
    expect(screen.getByTestId("portal-health")).toHaveTextContent("5"); // green count
  });

  it("shows an unavailable notice for a non-guest (status errors)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "no portal project in scope" }), { status: 400 })),
    );
    renderWithProviders(<Portal />, { client: seed("viewer") });
    expect(await screen.findByTestId("portal-unavailable")).toBeInTheDocument();
    // The page still paints its own heading (what the e2e smoke asserts).
    expect(screen.getByRole("heading", { name: /project portal/i })).toBeInTheDocument();
  });
});
