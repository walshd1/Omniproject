import { describe, it, expect, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, type Capabilities } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { ViewSwitcher } from "./ViewSwitcher";
import { useStore } from "../store/useStore";

function caps(over: Partial<Capabilities> = {}): Capabilities {
  return {
    mode: "n8n",
    issues: true,
    scheduling: true,
    resources: true,
    financials: true,
    portfolio: true,
    baseline: true,
    blockers: true,
    history: true,
    raid: true,
    quality: true,
    crm: true,
    service: true,
    benefits: true,
    stakeholders: true,
    raci: true,
    timeTravel: false,
    ...over,
  };
}

function seeded(c?: Capabilities): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (c) qc.setQueryData(getGetCapabilitiesQueryKey(), c);
  return qc;
}

beforeEach(() => {
  useStore.setState({ currentView: "kanban" });
});

describe("ViewSwitcher", () => {
  it("shows the active view's short label on the trigger", () => {
    useStore.setState({ currentView: "gantt" });
    renderWithProviders(<ViewSwitcher />, { client: seeded(caps()) });
    expect(screen.getByTestId("view-switcher")).toHaveTextContent("Gantt");
  });

  it("opens the menu and lists view options grouped by methodology", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ViewSwitcher />, { client: seeded(caps()) });
    await user.click(screen.getByTestId("view-switcher"));

    expect(await screen.findByText("Kanban Board")).toBeInTheDocument();
    expect(screen.getByText("Gantt Timeline")).toBeInTheDocument();
    expect(screen.getByText("RAID Log")).toBeInTheDocument();
    // Group labels.
    expect(screen.getByText("Agile")).toBeInTheDocument();
    expect(screen.getByText("Traditional")).toBeInTheDocument();
  });

  it("selecting a view updates the store", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ViewSwitcher />, { client: seeded(caps()) });
    await user.click(screen.getByTestId("view-switcher"));
    await user.click(await screen.findByText("Gantt Timeline"));
    expect(useStore.getState().currentView).toBe("gantt");
  });

  it("flags views as limited when their needed capability is missing", async () => {
    const user = userEvent.setup();
    // scheduling=false → Gantt (needs scheduling) limited; raid=false → RAID limited.
    renderWithProviders(<ViewSwitcher />, {
      client: seeded(caps({ scheduling: false, raid: false })),
    });
    await user.click(screen.getByTestId("view-switcher"));
    expect(await screen.findByText(/limited \(no scheduling\)/)).toBeInTheDocument();
    expect(screen.getByText(/limited \(no raid\)/)).toBeInTheDocument();
  });

  it("does not flag views as limited when capabilities are unknown", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ViewSwitcher />, { client: seeded() });
    await user.click(screen.getByTestId("view-switcher"));
    await screen.findByText("Gantt Timeline");
    expect(screen.queryByText(/limited/)).not.toBeInTheDocument();
  });

  it("hides views the methodology composition curates out (current view still listed)", async () => {
    const user = userEvent.setup();
    useStore.setState({ currentView: "kanban" });
    const qc = seeded(caps());
    // Curate to just the kanban view — RAID and Gantt are excluded.
    qc.setQueryData(["methodology-composition"], { methodologyComposition: ["view:kanban"] });
    renderWithProviders(<ViewSwitcher />, { client: qc });
    await user.click(screen.getByTestId("view-switcher"));
    expect(await screen.findByText("Kanban Board")).toBeInTheDocument(); // current, kept
    expect(screen.queryByText("RAID Log")).not.toBeInTheDocument(); // curated out
    expect(screen.queryByText("Gantt Timeline")).not.toBeInTheDocument();
  });

  it("marks the current view with a check", async () => {
    const user = userEvent.setup();
    useStore.setState({ currentView: "list" });
    renderWithProviders(<ViewSwitcher />, { client: seeded(caps()) });
    await user.click(screen.getByTestId("view-switcher"));
    const item = (await screen.findByText("List / Table")).closest("[role='menuitem']");
    expect(within(item as HTMLElement).getByText("List / Table")).toBeInTheDocument();
  });
});
