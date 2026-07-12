import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { fieldRoutingQueryKey, type FieldRoute } from "../../lib/routing";
import { availabilityQueryKey } from "../../lib/availability";
import { RoutingMatrix } from "./RoutingMatrix";

function seed(role: string | undefined, routes: FieldRoute[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (role) qc.setQueryData(["auth", "me"], { authenticated: true, role, user: { sub: "u1" } });
  qc.setQueryData(fieldRoutingQueryKey, routes);
  return qc;
}

afterEach(() => vi.restoreAllMocks());

describe("RoutingMatrix", () => {
  it("renders nothing for a non-admin", () => {
    renderWithProviders(<RoutingMatrix />, { client: seed("pmo", []) });
    expect(screen.queryByTestId("routing-matrix")).not.toBeInTheDocument();
  });

  it("shows the admin matrix seeded from the server", () => {
    renderWithProviders(<RoutingMatrix />, { client: seed("admin", [{ uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate" }]) });
    expect(screen.getByTestId("routing-matrix")).toBeInTheDocument();
    expect(screen.getByLabelText("Row 1 vendor")).toHaveValue("jira");
  });

  it("flags a collision (same UI element twice) and disables Save", async () => {
    renderWithProviders(<RoutingMatrix />, { client: seed("admin", [{ uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate" }]) });
    // Add a second row that also targets dueDate from a different source → target collision.
    fireEvent.click(screen.getByTestId("routing-add"));
    fireEvent.change(screen.getByLabelText("Row 2 UI element"), { target: { value: "dueDate" } });
    fireEvent.change(screen.getByLabelText("Row 2 vendor"), { target: { value: "sql" } });
    fireEvent.change(screen.getByLabelText("Row 2 broker"), { target: { value: "n8n" } });
    fireEvent.change(screen.getByLabelText("Row 2 source field"), { target: { value: "due" } });

    expect(screen.getByTestId("routing-collision")).toBeInTheDocument();
    expect(screen.getByTestId("routing-save")).toBeDisabled();
  });

  it("restricts the field list to advertised ∪ mapped when a live broker is wired", () => {
    const qc = seed("admin", [{ uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate" }]);
    qc.setQueryData(availabilityQueryKey, { source: "capabilities", fields: ["budget"], available: ["budget"], hidden: [], tables: [], relationships: [] });
    qc.setQueryData(["setup", "status"], { broker: { configured: true } });
    renderWithProviders(<RoutingMatrix />, { client: qc });

    expect(screen.getByTestId("routing-state").textContent).toMatch(/1 field/); // advertised count
    const opts = Array.from(document.querySelectorAll("#routing-ui-elements option")).map((o) => o.getAttribute("value"));
    expect(opts).toContain("budget"); // advertised
    expect(opts).toContain("dueDate"); // already-mapped stays selectable
    expect(opts).not.toContain("status"); // a superset field the backend doesn't advertise is hidden
    expect(opts.length).toBeLessThan(5); // narrowed, not the whole superset
  });

  it("PUTs the map to /api/routing on save", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderWithProviders(<RoutingMatrix />, { client: seed("admin", []) });

    fireEvent.click(screen.getByTestId("routing-add"));
    fireEvent.change(screen.getByLabelText("Row 1 UI element"), { target: { value: "budget" } });
    fireEvent.change(screen.getByLabelText("Row 1 vendor"), { target: { value: "sql" } });
    fireEvent.change(screen.getByLabelText("Row 1 broker"), { target: { value: "sidecar" } });
    fireEvent.change(screen.getByLabelText("Row 1 source field"), { target: { value: "budget_amount" } });
    fireEvent.click(screen.getByTestId("routing-save"));

    const put = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(String(put[0])).toMatch(/\/routing$/);
    expect(JSON.parse(String(put[1]?.body)).fieldRouting).toEqual([
      { uiElement: "budget", vendor: "sql", broker: "sidecar", sourceField: "budget_amount" },
    ]);
  });
});
